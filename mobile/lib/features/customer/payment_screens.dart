import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../core/config.dart';
import '../../core/l10n.dart';
import '../../core/theme/brand.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/states.dart';
import '../../models/customer.dart';
import 'customer_providers.dart';

final paymentProvider = FutureProvider.autoDispose.family<PaymentDetail, String>((ref, id) => ref.watch(customerRepositoryProvider).payment(id));

/// Pay one payment: gateway (eSewa form post / Khalti URL in a webview → poll), bank transfer (details + proof
/// upload), switch method, or show the result.
class PaymentScreen extends ConsumerStatefulWidget {
  const PaymentScreen({super.key, required this.paymentId});
  final String paymentId;

  @override
  ConsumerState<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends ConsumerState<PaymentScreen> {
  bool _polling = false;
  bool _pollTimedOut = false;

  Future<void> _payOnline(PaymentDetail p) async {
    final repo = ref.read(customerRepositoryProvider);
    final start = await repo.startPayment(p.id);
    if (!mounted) return;
    if (start.kind == 'done') {
      ref.invalidate(paymentProvider(p.id));
      return;
    }
    if (start.kind != 'esewa' && start.kind != 'khalti') {
      ref.invalidate(paymentProvider(p.id));
      return;
    }
    await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => GatewayScreen(start: start), fullscreenDialog: true));
    // Whether the browser closed on a return URL or the user backed out, ask the server — the redirect proves nothing.
    await _poll(p.id);
  }

  /// Poll GET /payments/{id} until it leaves PENDING (≈1 min), then stop and let the user check again.
  Future<void> _poll(String id) async {
    setState(() {
      _polling = true;
      _pollTimedOut = false;
    });
    final repo = ref.read(customerRepositoryProvider);
    for (var i = 0; i < 20 && mounted; i++) {
      try {
        final p = await repo.payment(id);
        if (p.status != 'PENDING') break;
      } catch (_) {
        // offline blip: keep polling
      }
      await Future<void>.delayed(const Duration(seconds: 3));
      if (i == 19 && mounted) setState(() => _pollTimedOut = true);
    }
    if (!mounted) return;
    setState(() => _polling = false);
    ref.invalidate(paymentProvider(id));
    ref.invalidate(upcomingOrdersProvider);
    ref.invalidate(walletProvider);
  }

  Future<void> _switch(PaymentDetail p) async {
    final l = context.l10n;
    final m = await pickFromList<String>(context, title: l.switchMethod, items: p.switchableMethods.where((m) => m != p.method).toList(), label: l.paymentMethod);
    if (m == null || !mounted) return;
    try {
      await ref.read(customerRepositoryProvider).switchMethod(p.id, m);
      ref.invalidate(paymentProvider(p.id));
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l.payment)),
      body: _polling
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(mainAxisSize: MainAxisSize.min, children: [const CircularProgressIndicator(), const SizedBox(height: 16), Text(l.checkingPayment, textAlign: TextAlign.center)]),
              ),
            )
          : ProviderBody<PaymentDetail>(
              provider: paymentProvider(widget.paymentId),
              builder: (context, p) => ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                children: [
                  SectionCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(children: [Expanded(child: Text(p.reference, style: Theme.of(context).textTheme.titleMedium)), StatusChip(p.status)]),
                        const SizedBox(height: 8),
                        MoneyText(p.amount, strong: true, style: Theme.of(context).textTheme.headlineSmall),
                        Text(l.paymentMethod(p.method)),
                        if (p.subscriptionPlanName != null) Text(p.subscriptionPlanName!),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  ..._body(context, p),
                ],
              ),
            ),
    );
  }

  List<Widget> _body(BuildContext context, PaymentDetail p) {
    final l = context.l10n;
    if (p.isPaid) {
      return [
        Notice(l.paymentPaid, tone: Tone.good, icon: Icons.check_circle),
        const SizedBox(height: 16),
        FilledButton(onPressed: () => context.go('/c/orders'), child: Text(l.viewOrders)),
      ];
    }
    if (p.expired || p.status == 'CANCELLED') return [Notice(l.paymentExpired, tone: Tone.neutral)];
    final widgets = <Widget>[
      if (p.status == 'FAILED') ...[Notice(l.paymentFailed, tone: Tone.bad), const SizedBox(height: 12)],
      if (_pollTimedOut && p.status == 'PENDING') ...[Notice(l.paymentStillPending, tone: Tone.warn), const SizedBox(height: 12)],
    ];
    if (p.isGateway) {
      widgets.addAll([
        BusyButton(key: const Key('pay-online'), label: l.payNow(rs(context, p.amount)), icon: Icons.lock_outline, onPressed: () => _payOnline(p)),
        const SizedBox(height: 8),
        OutlinedButton(onPressed: () => _poll(p.id), child: Text(l.checkAgain)),
      ]);
    } else if (p.method == 'BANK_TRANSFER') {
      widgets.add(BankTransferPanel(payment: p, onSent: () => ref.invalidate(paymentProvider(p.id))));
    } else if (p.method == 'CASH') {
      widgets.add(Notice(l.cashNote));
    }
    if (p.switchableMethods.where((m) => m != p.method).isNotEmpty && !p.awaitingVerification) {
      widgets.addAll([const SizedBox(height: 8), TextButton(onPressed: () => _switch(p), child: Text(l.switchMethod))]);
    }
    return widgets;
  }
}

class BankTransferPanel extends ConsumerStatefulWidget {
  const BankTransferPanel({super.key, required this.payment, required this.onSent});
  final PaymentDetail payment;
  final VoidCallback onSent;

  @override
  ConsumerState<BankTransferPanel> createState() => _BankTransferPanelState();
}

class _BankTransferPanelState extends ConsumerState<BankTransferPanel> {
  final _ref = TextEditingController();
  XFile? _file;

  @override
  void dispose() {
    _ref.dispose();
    super.dispose();
  }

  Future<void> _pick(ImageSource src) async {
    final f = await ImagePicker().pickImage(source: src, maxWidth: 2000, imageQuality: 85);
    if (f != null && mounted) setState(() => _file = f);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final p = widget.payment;
    if (p.awaitingVerification) return Notice(l.awaitingVerification, tone: Tone.info);
    final qr = p.bankQrImage;
    return SectionCard(
      title: l.bankDetails,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (p.bankDetails != null) SelectableText(p.bankDetails!),
          if (qr != null && qr.isNotEmpty) ...[
            const SizedBox(height: 12),
            Center(
              child: Image.network(
                qr.startsWith('http') ? qr : '${AppConfig.siteOrigin}${qr.startsWith('/') ? '' : '/'}$qr',
                width: 220,
                errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                semanticLabel: l.bankDetails,
              ),
            ),
          ],
          const SizedBox(height: 12),
          Text(l.bankHelp),
          const SizedBox(height: 12),
          TextField(controller: _ref, decoration: InputDecoration(labelText: l.transferReference)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              OutlinedButton.icon(onPressed: () => _pick(ImageSource.gallery), icon: const Icon(Icons.photo_library_outlined), label: Text(l.chooseReceipt)),
              OutlinedButton.icon(onPressed: () => _pick(ImageSource.camera), icon: const Icon(Icons.photo_camera_outlined), label: Text(l.takeReceiptPhoto)),
            ],
          ),
          if (_file != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text('✓ ${_file!.name}')),
          const SizedBox(height: 12),
          BusyButton(
            label: l.uploadProof,
            onPressed: _file == null
                ? null
                : () async {
                    if (_ref.text.trim().length < 3) {
                      showSnack(context, l.transferReference);
                      return;
                    }
                    final f = _file!;
                    await ref.read(customerRepositoryProvider).uploadProof(p.id, filePath: f.path, fileName: f.name, fileLength: await f.length(), reference: _ref.text.trim());
                    if (!context.mounted) return;
                    showSnack(context, l.proofSent);
                    widget.onSent();
                  },
          ),
        ],
      ),
    );
  }
}

/// In-app browser for eSewa (auto-submitted form POST) / Khalti (URL). Pops when it reaches a return URL.
class GatewayScreen extends StatefulWidget {
  const GatewayScreen({super.key, required this.start});
  final PaymentStart start;

  @override
  State<GatewayScreen> createState() => _GatewayScreenState();
}

class _GatewayScreenState extends State<GatewayScreen> {
  late final WebViewController _controller;
  bool _loading = true;
  bool _closed = false;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (req) {
            if (widget.start.isReturnUrl(req.url)) {
              _close(true);
              return NavigationDecision.prevent;
            }
            return NavigationDecision.navigate;
          },
          onPageStarted: (url) {
            if (widget.start.isReturnUrl(url)) _close(true);
          },
          onPageFinished: (_) {
            if (mounted) setState(() => _loading = false);
          },
        ),
      );
    final s = widget.start;
    if (s.kind == 'esewa' && s.action != null) {
      _controller.loadHtmlString(esewaAutoSubmitHtml(s.action!, s.fields));
    } else if (s.url != null) {
      _controller.loadRequest(Uri.parse(s.url!));
    }
  }

  void _close(bool returned) {
    if (_closed || !mounted) return;
    _closed = true;
    Navigator.of(context).pop(returned);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(
        title: Text(l.gatewayTitle),
        leading: IconButton(tooltip: l.close, icon: const Icon(Icons.close), onPressed: () => _close(false)),
      ),
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_loading)
            Container(
              color: BrandColors.paper,
              alignment: Alignment.center,
              child: Text(l.openingGateway(widget.start.kind == 'esewa' ? l.pmESEWA : l.pmKHALTI)),
            ),
        ],
      ),
    );
  }
}

/// eSewa needs a browser form POST: an HTML page that submits itself. Values are HTML-escaped.
String esewaAutoSubmitHtml(String action, Map<String, String> fields) {
  const esc = HtmlEscape(HtmlEscapeMode.attribute);
  final inputs = fields.entries.map((e) => '<input type="hidden" name="${esc.convert(e.key)}" value="${esc.convert(e.value)}">').join();
  return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
      '<body onload="document.forms[0].submit()" style="font-family:sans-serif;text-align:center;padding-top:40px">'
      '<form method="POST" action="${esc.convert(action)}">$inputs<noscript><button type="submit">Continue to eSewa</button></noscript></form>'
      '<p>Opening eSewa…</p></body></html>';
}
