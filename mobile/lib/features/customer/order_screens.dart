import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format/dates.dart';
import '../../core/l10n.dart';
import '../../core/theme/brand.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/paged_list.dart';
import '../../core/widgets/states.dart';
import '../../models/customer.dart';
import 'customer_providers.dart';
import 'home_screen.dart';

class OrdersScreen extends ConsumerWidget {
  const OrdersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final repo = ref.watch(customerRepositoryProvider);
    Widget list(String scope) => PagedList<OrderSummary>(
          key: PageStorageKey('orders-$scope'),
          fetch: (cursor) => repo.orders(scope: scope, cursor: cursor),
          emptyMessage: l.noOrders,
          emptyIcon: Icons.receipt_long_outlined,
          itemBuilder: (c, o) => ListTile(
            title: Text(o.items.map((i) => i.toString()).join(', '), maxLines: 2, overflow: TextOverflow.ellipsis),
            subtitle: Text('${KtmDates.serviceDay(o.deliveryDate, locale: context.lang)} · ${o.number} · ${rs(context, o.customerShare)}'),
            trailing: StatusChip(o.status),
            onTap: () => context.push('/c/order/${o.id}'),
          ),
        );
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l.tabOrders),
          actions: [IconButton(tooltip: l.myPlans, onPressed: () => context.go('/c/plans'), icon: const Icon(Icons.event_repeat))],
          bottom: TabBar(tabs: [Tab(text: l.ordersUpcoming), Tab(text: l.ordersPast)]),
        ),
        body: TabBarView(children: [list('upcoming'), list('past')]),
      ),
    );
  }
}

class OrderDetailScreen extends ConsumerWidget {
  const OrderDetailScreen({super.key, required this.orderId});
  final String orderId;

  void _refresh(WidgetRef ref) {
    ref.invalidate(orderProvider(orderId));
    ref.invalidate(timelineProvider(orderId));
    ref.invalidate(upcomingOrdersProvider);
  }

  Future<void> _run(BuildContext context, WidgetRef ref, Future<String> Function() action) async {
    try {
      final msg = await action();
      if (context.mounted && msg.isNotEmpty) showSnack(context, msg);
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
    _refresh(ref);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final repo = ref.watch(customerRepositoryProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.tabOrders)),
      body: ProviderBody<OrderDetail>(
        provider: orderProvider(orderId),
        builder: (context, o) {
          final a = o.actions;
          return ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                children: [
                  Expanded(child: Text(l.orderNumber(o.number), style: Theme.of(context).textTheme.titleLarge)),
                  StatusChip(o.status),
                ],
              ),
              Text([KtmDates.serviceDayLong(o.deliveryDate, locale: context.lang), if (o.slotLabel != null) o.slotLabel!].join(' · ')),
              if (o.subscriptionPlanName != null)
                TextButton.icon(
                  style: TextButton.styleFrom(padding: EdgeInsets.zero, alignment: Alignment.centerLeft),
                  onPressed: () => context.push('/c/my-plan/${o.subscriptionId}'),
                  icon: const Icon(Icons.event_repeat, size: 18),
                  label: Text(o.subscriptionPlanName!),
                ),
              if (o.deliveryOtp != null) ...[const SizedBox(height: 8), HandOffCode(code: o.deliveryOtp!)],
              if (o.windowOpen && o.cutoff.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Notice(l.changesUntil(o.cutoff), icon: Icons.schedule)),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (a.pay && o.payment != null)
                    FilledButton.icon(onPressed: () => context.push('/c/pay/${o.payment!.id}'), icon: const Icon(Icons.payments_outlined), label: Text(l.payment)),
                  if (a.swap)
                    OutlinedButton.icon(
                      onPressed: () async {
                        await showSwapSheet(context, ref, o.id);
                        _refresh(ref);
                      },
                      icon: const Icon(Icons.swap_horiz),
                      label: Text(l.swapDabba),
                    ),
                  if (a.skip)
                    OutlinedButton.icon(
                      onPressed: () async {
                        if (await confirmDialog(context, title: l.skipMeal)) {
                          if (context.mounted) await _run(context, ref, () => repo.skip(o.id));
                        }
                      },
                      icon: const Icon(Icons.event_busy),
                      label: Text(l.skipMeal),
                    ),
                  if (a.unskip) OutlinedButton.icon(onPressed: () => _run(context, ref, () => repo.unskip(o.id)), icon: const Icon(Icons.event_available), label: Text(l.unskipMeal)),
                  if (a.cancel)
                    OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(foregroundColor: BrandColors.sindoor),
                      onPressed: () async {
                        final reason = await promptText(context, title: l.cancelOrder, label: '${l.reason} (${l.optional})', confirmLabel: l.cancelOrder);
                        if (reason != null && context.mounted) await _run(context, ref, () => repo.cancelOrder(o.id, reason));
                      },
                      icon: const Icon(Icons.cancel_outlined),
                      label: Text(l.cancelOrder),
                    ),
                  if (a.feedback) OutlinedButton.icon(onPressed: () => _feedback(context, ref, o), icon: const Icon(Icons.star_outline), label: Text(l.rateMeal)),
                ],
              ),
              const SizedBox(height: 16),
              SectionCard(
                title: l.items,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final it in o.items) ...[
                      InfoRow('${it.quantity} × ${it.name}', rs(context, it.lineTotal)),
                      if (it.components.isNotEmpty) Text(it.components.join(', '), style: Theme.of(context).textTheme.bodySmall),
                      if (it.customizations.isNotEmpty) Text(it.customizations.join(', '), style: Theme.of(context).textTheme.bodySmall),
                    ],
                    if (o.allergenNote != null) Padding(padding: const EdgeInsets.only(top: 8), child: Notice(o.allergenNote!, tone: Tone.warn)),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              SectionCard(
                title: l.total,
                child: Column(
                  children: [
                    InfoRow(l.subtotal, rs(context, _int(o.money['subtotal']))),
                    InfoRow(l.deliveryFee, rs(context, _int(o.money['deliveryFee']))),
                    if (_int(o.money['discount']) > 0) InfoRow(l.discount, '−${rs(context, _int(o.money['discount']))}'),
                    InfoRow(l.total, rs(context, _int(o.money['total'])), bold: true),
                    if (_int(o.money['companyShare']) > 0) InfoRow(l.youPay, rs(context, _int(o.money['customerShare'])), bold: true),
                    if (o.payment != null) InfoRow(l.payWith, '${l.paymentMethod(o.payment!.method)} · ${l.statusLabel(o.payment!.status)}'),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              SectionCard(
                title: l.delivery,
                child: Text(
                  [o.delivery['contactName'], o.delivery['placeName'], o.delivery['addressLine'], o.delivery['area'], o.delivery['landmark'], o.delivery['instructions']]
                      .whereType<String>()
                      .where((s) => s.isNotEmpty)
                      .join('\n'),
                ),
              ),
              const SizedBox(height: 12),
              _Timeline(orderId: o.id),
              const SizedBox(height: 12),
              TextButton.icon(
                onPressed: () => context.push('/c/support/new?orderId=${o.id}'),
                icon: const Icon(Icons.support_agent),
                label: Text(l.getHelp),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _feedback(BuildContext context, WidgetRef ref, OrderDetail o) async {
    final l = context.l10n;
    var rating = o.feedbackRating ?? 5;
    final comment = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: Text(l.rateMeal),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (var i = 1; i <= 5; i++)
                    IconButton(
                      tooltip: '$i',
                      onPressed: () => set(() => rating = i),
                      icon: Icon(i <= rating ? Icons.star_rounded : Icons.star_outline_rounded, color: BrandColors.haldi, size: 32),
                    ),
                ],
              ),
              TextField(controller: comment, maxLines: 3, maxLength: 1000, decoration: InputDecoration(labelText: '${l.comment} (${l.optional})')),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(l.cancel)),
            FilledButton(onPressed: () => Navigator.pop(c, true), child: Text(l.send)),
          ],
        ),
      ),
    );
    final text = comment.text.trim();
    comment.dispose();
    if (ok != true || !context.mounted) return;
    await _run(context, ref, () async {
      await ref.read(customerRepositoryProvider).feedback(o.id, rating: rating, comment: text.isEmpty ? null : text);
      return l.thanksFeedback;
    });
  }
}

int _int(Object? v) => v is num ? v.round() : 0;

class _Timeline extends ConsumerWidget {
  const _Timeline({required this.orderId});
  final String orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final t = ref.watch(timelineProvider(orderId));
    return SectionCard(
      title: l.timeline,
      child: t.when(
        loading: () => const LoadingView(),
        error: (e, _) => Text(l.errorTitle),
        data: (tl) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (tl.steps.isNotEmpty)
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (var i = 0; i < tl.steps.length; i++)
                    StatusChip(tl.steps[i], tone: tl.currentStep >= i ? toneFor('DONE') : null, label: l.statusLabel(tl.steps[i])),
                ],
              ),
            const SizedBox(height: 8),
            for (final e in tl.events.reversed)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: Icon(e.kind == 'DELIVERY' ? Icons.two_wheeler : Icons.circle, size: e.kind == 'DELIVERY' ? 20 : 10),
                title: Text(e.toStatus != null ? l.statusLabel(e.toStatus!) : humanize(e.type ?? e.kind)),
                subtitle: Text([KtmDates.timestamp(e.at, locale: context.lang), if (e.note != null) e.note!].join(' · ')),
              ),
          ],
        ),
      ),
    );
  }
}

/// Swap a plan meal's dabba. Pay-the-difference: delta > 0 → choose WALLET / ESEWA / KHALTI; PAY → payment screen.
Future<void> showSwapSheet(BuildContext context, WidgetRef ref, String orderId) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (c) => _SwapSheet(orderId: orderId),
  );
}

class _SwapSheet extends ConsumerStatefulWidget {
  const _SwapSheet({required this.orderId});
  final String orderId;

  @override
  ConsumerState<_SwapSheet> createState() => _SwapSheetState();
}

class _SwapSheetState extends ConsumerState<_SwapSheet> {
  late final Future<List<SwapOption>> _options = ref.read(customerRepositoryProvider).swapOptions(widget.orderId);
  SwapOption? _pick;
  String _method = 'WALLET';

  Future<void> _submit() async {
    final o = _pick!;
    final res = await ref.read(customerRepositoryProvider).swap(widget.orderId, o.boxId, method: o.delta > 0 ? _method : null);
    if (!mounted) return;
    final router = GoRouter.of(context);
    Navigator.pop(context);
    if (res.next == 'PAY' && res.paymentId != null) {
      await router.push('/c/pay/${res.paymentId}');
    } else if (res.message.isNotEmpty && mounted) {
      showSnack(context, res.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return SafeArea(
      child: FutureBuilder<List<SwapOption>>(
        future: _options,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) return const SizedBox(height: 200, child: LoadingView());
          if (snap.hasError) return ErrorView(error: snap.error!);
          final opts = snap.data!;
          return ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            children: [
              Text(l.swapTitle, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              for (final o in opts)
                RadioListTile<String>(
                  contentPadding: EdgeInsets.zero,
                  value: o.boxId,
                  groupValue: _pick?.boxId,
                  onChanged: o.current || o.soldOut ? null : (_) => setState(() => _pick = o),
                  title: Text(o.name),
                  subtitle: Text(
                    o.current
                        ? l.current
                        : o.soldOut
                            ? l.soldOut
                            : o.delta > 0
                                ? l.swapPayMore(rs(context, o.delta))
                                : o.delta < 0
                                    ? l.swapCredit(rs(context, -o.delta))
                                    : l.swapSame,
                  ),
                ),
              if (_pick != null && _pick!.delta > 0) ...[
                const SizedBox(height: 8),
                Text(l.payDifferenceWith, style: Theme.of(context).textTheme.titleSmall),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final m in const ['WALLET', 'ESEWA', 'KHALTI'])
                      ChoiceChip(label: Text(l.paymentMethod(m)), selected: _method == m, onSelected: (_) => setState(() => _method = m)),
                  ],
                ),
              ],
              const SizedBox(height: 16),
              BusyButton(label: l.swapDabba, onPressed: _pick == null ? null : _submit),
            ],
          );
        },
      ),
    );
  }
}
