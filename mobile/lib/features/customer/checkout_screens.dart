import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format/dates.dart';
import '../../core/l10n.dart';
import '../../core/providers.dart';
import '../../core/theme/brand.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/states.dart';
import '../../models/catalog.dart';
import '../../models/customer.dart';
import 'customer_providers.dart';

class CartScreen extends ConsumerWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final items = ref.watch(cartProvider);
    final cart = ref.read(cartProvider.notifier);
    final estimate = items.fold<int>(0, (s, e) => s + e.unitPrice * e.qty);
    return Scaffold(
      appBar: AppBar(title: Text(l.cart)),
      body: items.isEmpty
          ? EmptyView(
              message: l.cartEmpty,
              icon: Icons.shopping_bag_outlined,
              action: FilledButton(onPressed: () => context.go('/c/menu'), child: Text(l.browseMenu)),
            )
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                for (final it in items)
                  Card(
                    margin: const EdgeInsets.only(bottom: 10),
                    child: ListTile(
                      title: Text(it.name),
                      subtitle: Text('${KtmDates.serviceDay(it.date, locale: context.lang)} · ${rs(context, it.unitPrice)}'),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(tooltip: '-', onPressed: () => cart.setQty(it.key, it.qty - 1), icon: const Icon(Icons.remove_circle_outline)),
                          Text('${it.qty}'),
                          IconButton(tooltip: '+', onPressed: () => cart.setQty(it.key, it.qty + 1), icon: const Icon(Icons.add_circle_outline)),
                        ],
                      ),
                    ),
                  ),
                InfoRow(l.subtotal, rs(context, estimate), bold: true),
                const SizedBox(height: 16),
                FilledButton(onPressed: () => context.push('/c/checkout'), child: Text(l.checkout)),
              ],
            ),
    );
  }
}

/// Address, slot, payment method, coupon → server quote (/cart/quote) → place order (idempotent) → pay or done.
class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({super.key});

  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  String? _addressId;
  String? _slotId;
  String? _method;
  String? _coupon;
  final _couponCtrl = TextEditingController();
  final _notes = TextEditingController();
  Future<CartQuote>? _quote;
  List<Slot> _slots = const [];

  @override
  void dispose() {
    _couponCtrl.dispose();
    _notes.dispose();
    super.dispose();
  }

  List<CartLine> get _lines => ref.read(cartProvider).map((e) => e.toLine()).toList();

  void _requote() {
    final lines = _lines;
    if (lines.isEmpty) return;
    setState(() => _quote = ref.read(customerRepositoryProvider).quote(lines, addressId: _addressId, coupon: _coupon));
  }

  Future<void> _selectAddress(Address a) async {
    setState(() {
      _addressId = a.id;
      _slotId = null;
      _slots = const [];
    });
    _requote();
    try {
      final cov = await ref.read(customerRepositoryProvider).coverageFor(a);
      if (mounted) setState(() => _slots = cov.slots);
    } catch (_) {
      // Slots are optional; the server picks the usual window.
    }
  }

  Future<void> _place(CartQuote q) async {
    final l = context.l10n;
    final res = await ref.read(customerRepositoryProvider).placeOrder(
          lines: _lines,
          addressId: _addressId!,
          method: _method!,
          slotId: _slotId,
          coupon: _coupon,
          notes: _notes.text.trim().isEmpty ? null : _notes.text.trim(),
        );
    ref.read(cartProvider.notifier).clear();
    ref.invalidate(upcomingOrdersProvider);
    if (!mounted) return;
    if (res.mustPay) {
      context.pushReplacement('/c/pay/${res.payment!.id}');
    } else {
      await showDialog<void>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text(l.orderPlaced),
          content: Text(_method == 'CASH' ? '${l.orderPlacedBody}\n\n${l.cashNote}' : l.orderPlacedBody),
          actions: [FilledButton(onPressed: () => Navigator.pop(c), child: Text(l.viewOrders))],
        ),
      );
      if (mounted) context.go('/c/orders');
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final addresses = ref.watch(addressesProvider);
    final settings = ref.watch(settingsProvider);
    final wallet = ref.watch(walletProvider).valueOrNull;
    final methods = <String>[...?settings.valueOrNull?.paymentMethods];
    if ((wallet?.walletEnabled ?? false) && wallet!.balance > 0 && !methods.contains('WALLET')) methods.add('WALLET');
    if (_method != null && !methods.contains(_method)) _method = null;
    _method ??= methods.firstOrNull;

    return Scaffold(
      appBar: AppBar(title: Text(l.checkout)),
      body: addresses.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(addressesProvider)),
        data: (list) {
          if (_addressId == null && list.isNotEmpty) {
            final def = list.firstWhere((a) => a.isDefault, orElse: () => list.first);
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (mounted && _addressId == null) _selectAddress(def);
            });
          }
          final selected = list.where((a) => a.id == _addressId).firstOrNull;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              SectionCard(
                title: l.deliverTo,
                child: list.isEmpty
                    ? OutlinedButton.icon(
                        onPressed: () async {
                          await context.push('/c/address/new');
                          ref.invalidate(addressesProvider);
                        },
                        icon: const Icon(Icons.add_location_alt_outlined),
                        label: Text(l.addAddress),
                      )
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          if (selected != null) ...[
                            Text(selected.label.isEmpty ? selected.recipientName : selected.label, style: const TextStyle(fontWeight: FontWeight.w700)),
                            Text(selected.oneLine),
                            if (!selected.covered) Padding(padding: const EdgeInsets.only(top: 6), child: Notice(l.notCovered, tone: Tone.bad)),
                          ],
                          TextButton(
                            onPressed: () async {
                              final a = await pickFromList<Address>(context, title: l.deliverTo, items: list, label: (a) => '${a.label.isEmpty ? a.type : a.label} — ${a.oneLine}', selected: selected);
                              if (a != null) await _selectAddress(a);
                            },
                            child: Text(l.changeAddress),
                          ),
                        ],
                      ),
              ),
              if (_slots.isNotEmpty) ...[
                const SizedBox(height: 12),
                SectionCard(
                  title: l.deliverySlot,
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      ChoiceChip(label: Text(l.anySlot), selected: _slotId == null, onSelected: (_) => setState(() => _slotId = null)),
                      for (final s in _slots) ChoiceChip(label: Text(s.label), selected: _slotId == s.id, onSelected: (_) => setState(() => _slotId = s.id)),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 12),
              SectionCard(
                title: l.payWith,
                child: settings.isLoading
                    ? const LoadingView()
                    : RadioGroupList(
                        values: methods,
                        selected: _method,
                        label: (m) => m == 'WALLET' && wallet != null ? '${l.paymentMethod(m)} · ${l.walletBalanceShort(rs(context, wallet.balance))}' : l.paymentMethod(m),
                        onChanged: (m) => setState(() => _method = m),
                      ),
              ),
              const SizedBox(height: 12),
              SectionCard(
                child: Row(
                  children: [
                    Expanded(child: TextField(controller: _couponCtrl, textCapitalization: TextCapitalization.characters, decoration: InputDecoration(labelText: l.coupon))),
                    const SizedBox(width: 8),
                    OutlinedButton(
                      onPressed: () {
                        _coupon = _couponCtrl.text.trim().isEmpty ? null : _couponCtrl.text.trim();
                        _requote();
                      },
                      child: Text(l.apply),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              TextField(controller: _notes, maxLength: 500, decoration: InputDecoration(labelText: '${l.notesForKitchen} (${l.optional})')),
              const SizedBox(height: 12),
              if (_quote != null)
                FutureBuilder<CartQuote>(
                  future: _quote,
                  builder: (context, snap) {
                    if (snap.connectionState != ConnectionState.done) return const LoadingView();
                    if (snap.hasError) return ErrorView(error: snap.error!, onRetry: _requote);
                    final q = snap.data!;
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        QuoteSummary(quote: q),
                        const SizedBox(height: 16),
                        BusyButton(
                          key: const Key('place-order'),
                          label: l.placeOrder,
                          icon: Icons.check_circle_outline,
                          onPressed: q.ok && _addressId != null && _method != null ? () => _place(q) : null,
                        ),
                      ],
                    );
                  },
                ),
              const SizedBox(height: 24),
            ],
          );
        },
      ),
    );
  }
}

/// Server-priced cart: lines (with per-line problems/warnings) and totals. Pure widget (widget-tested).
class QuoteSummary extends StatelessWidget {
  const QuoteSummary({super.key, required this.quote});
  final CartQuote quote;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final q = quote;
    return SectionCard(
      title: l.total,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (q.error != null) ...[Notice(q.error!, tone: Tone.bad), const SizedBox(height: 8)],
          if (q.addressProblem != null) ...[Notice(q.addressProblem!, tone: Tone.bad), const SizedBox(height: 8)],
          for (final line in q.lines) ...[
            InfoRow('${line.qty} × ${line.name} · ${KtmDates.serviceDay(line.date, locale: context.lang)}', rs(context, line.unitPrice * line.qty)),
            if (line.problem != null) Text(line.problem!, style: const TextStyle(color: BrandColors.sindoor, fontWeight: FontWeight.w600)),
            if (line.warning != null) Text(line.warning!, style: Theme.of(context).textTheme.bodySmall),
          ],
          const Divider(height: 20),
          InfoRow(l.subtotal, rs(context, q.subtotal)),
          InfoRow(l.deliveryFee, q.deliveryFee == 0 ? l.free : rs(context, q.deliveryFee)),
          if (q.couponDiscount > 0) InfoRow('${l.couponDiscount}${q.couponCode != null ? ' (${q.couponCode})' : ''}', '−${rs(context, q.couponDiscount)}'),
          if (q.companyDiscount > 0) InfoRow(l.discount, '−${rs(context, q.companyDiscount)}'),
          if (!q.taxInclusive && q.tax > 0) InfoRow(l.tax, rs(context, q.tax)),
          InfoRow(l.total, rs(context, q.total), bold: true),
          if (q.companyShare > 0) InfoRow(l.companyPays(q.companyName ?? ''), rs(context, q.companyShare)),
          if (q.companyShare > 0) InfoRow(l.youPay, rs(context, q.customerShare), bold: true),
          if (q.couponError != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(q.couponError!, style: const TextStyle(color: BrandColors.sindoor))),
          if (q.taxInclusive) Padding(padding: const EdgeInsets.only(top: 6), child: Text(l.taxIncluded, style: Theme.of(context).textTheme.bodySmall)),
          if (!q.ok && q.error == null && q.addressProblem == null) Padding(padding: const EdgeInsets.only(top: 8), child: Notice(l.fixProblems, tone: Tone.warn)),
        ],
      ),
    );
  }
}

/// Simple radio list for a few string options (48dp rows).
class RadioGroupList extends StatelessWidget {
  const RadioGroupList({super.key, required this.values, required this.selected, required this.label, required this.onChanged});
  final List<String> values;
  final String? selected;
  final String Function(String) label;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) => Column(
        children: [
          for (final v in values)
            RadioListTile<String>(
              contentPadding: EdgeInsets.zero,
              value: v,
              groupValue: selected,
              title: Text(label(v)),
              onChanged: (x) => x == null ? null : onChanged(x),
            ),
        ],
      );
}
