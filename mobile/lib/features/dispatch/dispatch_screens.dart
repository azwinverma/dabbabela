import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format/dates.dart';
import '../../core/json.dart';
import '../../core/l10n.dart';
import '../../core/theme/brand.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/states.dart';
import '../../models/auth.dart';
import '../../models/ops.dart';
import '../kitchen/staff_common.dart';
import '../shell/app_switcher.dart';

final dispatchBoardProvider = FutureProvider.autoDispose<DispatchBoard>((ref) async {
  final k = await ref.watch(currentKitchenProvider.future);
  return ref.watch(dispatchRepositoryProvider).board(k?.id, ref.watch(staffDateProvider));
});

final failedDeliveriesProvider = FutureProvider.autoDispose<List<FailedDelivery>>((ref) async {
  final k = await ref.watch(currentKitchenProvider.future);
  return ref.watch(dispatchRepositoryProvider).failed(k?.id, ref.watch(staffDateProvider));
});

/// Route /dispatch — board (manifest, unrouted orders, routes) and failed deliveries for a kitchen-day.
class DispatchHomeScreen extends ConsumerWidget {
  const DispatchHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l.appDispatcher),
          actions: const [StaffActions()],
          bottom: TabBar(tabs: [Tab(text: l.dispatchBoard), Tab(text: l.dispatchRoutes), Tab(text: l.dispatchFailed)]),
        ),
        body: AsyncView<List<KitchenRef>>(
          value: ref.watch(kitchensProvider),
          onRetry: () => ref.invalidate(kitchensProvider),
          data:
              (list) =>
                  list.isEmpty
                      ? EmptyView(message: l.noKitchens, icon: Icons.alt_route_outlined)
                      : const Column(
                        children: [
                          KitchenDateBar(),
                          Expanded(child: TabBarView(children: [_BoardTab(), _RoutesTab(), _FailedTab()])),
                        ],
                      ),
        ),
      ),
    );
  }
}

Future<String?> _kitchenId(WidgetRef ref) async => (await ref.read(currentKitchenProvider.future))?.id;

// ───────────── Board ─────────────

class _BoardTab extends ConsumerStatefulWidget {
  const _BoardTab();

  @override
  ConsumerState<_BoardTab> createState() => _BoardTabState();
}

class _BoardTabState extends ConsumerState<_BoardTab> {
  final Set<String> _selected = {};

  Future<void> _create(DispatchBoard b) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => _CreateRouteDialog(board: b, orderIds: _selected.toList()),
    );
    if (ok == true) {
      setState(_selected.clear);
      ref.invalidate(dispatchBoardProvider);
    }
  }

  Future<void> _addTo(DispatchBoard b) async {
    final l = context.l10n;
    final open = b.routes.where((r) => r.status != 'DONE').toList();
    final route = await pickFromList<DispatchRoute>(
      context,
      title: l.dispatchPickRoute,
      items: open,
      label: (r) => '${r.name} · ${CodeLabels(l).statusLabel(r.status)}',
    );
    if (route == null) return;
    await ref.read(dispatchRepositoryProvider).addOrders(route.id, _selected.toList());
    if (!mounted) return;
    setState(_selected.clear);
    ref.invalidate(dispatchBoardProvider);
  }

  Future<void> _autoGroup() async {
    final l = context.l10n;
    final ok = await confirmDialog(context, title: l.dispatchAutoGroup, body: l.dispatchAutoGroupConfirm);
    if (!ok) return;
    final k = await _kitchenId(ref);
    if (k == null) return;
    final r = await ref.read(dispatchRepositoryProvider).autoGroup(k, ref.read(staffDateProvider));
    ref.invalidate(dispatchBoardProvider);
    if (mounted) showSnack(context, l.dispatchAutoGrouped(r.integer('routes'), r.integer('stops')));
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final board = ref.watch(dispatchBoardProvider).valueOrNull;
    return Column(
      children: [
        Expanded(
          child: ProviderBody<DispatchBoard>(
            provider: dispatchBoardProvider,
            builder:
                (context, b) => ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(16),
                  children: [
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        StatTile(l.kitchenOrders, '${b.orders}'),
                        StatTile(l.dispatchHandOffPoints, '${b.handOffPoints}'),
                        StatTile(l.dispatchUnrouted, '${b.unroutedCount}', highlight: b.unroutedCount > 0),
                        StatTile(l.dispatchOut, '${b.out}'),
                        StatTile(l.dispatchFailed, '${b.failed}'),
                        if (b.changedAfterRouting > 0)
                          StatTile(l.dispatchChanged, '${b.changedAfterRouting}', highlight: true),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(child: Text(l.dispatchUnroutedOrders, style: Theme.of(context).textTheme.titleMedium)),
                        if (b.unrouted.isNotEmpty)
                          BusyButton(
                            expand: false,
                            outlined: true,
                            label: l.dispatchAutoGroup,
                            icon: Icons.auto_awesome_outlined,
                            onPressed: _autoGroup,
                          ),
                      ],
                    ),
                    if (b.unrouted.isEmpty)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Notice(l.dispatchAllRouted, tone: Tone.good),
                      )
                    else ...[
                      Align(
                        alignment: Alignment.centerLeft,
                        child: TextButton(
                          onPressed:
                              () => setState(() {
                                if (_selected.length == b.unrouted.length) {
                                  _selected.clear();
                                } else {
                                  _selected
                                    ..clear()
                                    ..addAll(b.unrouted.map((o) => o.id));
                                }
                              }),
                          child: Text(l.selectAll),
                        ),
                      ),
                      for (final o in b.unrouted)
                        CheckboxListTile(
                          contentPadding: EdgeInsets.zero,
                          value: _selected.contains(o.id),
                          onChanged: (v) => setState(() => v == true ? _selected.add(o.id) : _selected.remove(o.id)),
                          title: Row(
                            children: [
                              Expanded(child: Text(o.number, style: const TextStyle(fontWeight: FontWeight.w700))),
                              StatusChip(o.status),
                            ],
                          ),
                          subtitle: Text(
                            [
                              o.contactName,
                              l.meals(o.meals),
                              if (o.cashDue > 0) l.riderCollect(rs(context, o.cashDue)),
                            ].join(' · '),
                          ),
                        ),
                    ],
                    const SizedBox(height: 16),
                    Text(l.dispatchManifest, style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    if (b.groups.isEmpty) EmptyView(message: l.kitchenNoOrders),
                    for (final g in b.groups)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Card(
                          child: ExpansionTile(
                            shape: const Border(),
                            title: Text('${g.slot} · ${g.zone}', style: const TextStyle(fontWeight: FontWeight.w700)),
                            subtitle: Text('${l.dispatchHandOffPoints}: ${g.stops.length} · ${l.meals(g.meals)}'),
                            children: [
                              for (final s in g.stops)
                                ListTile(
                                  dense: true,
                                  title: Text([s.title, if (s.company != null) s.company!].join(' · ')),
                                  subtitle: Text(
                                    [
                                      if (s.landmark != null) s.landmark!,
                                      s.orders
                                          .map((o) => '${o.number}${o.route != null ? ' → ${o.route!.name}' : ''}')
                                          .join(', '),
                                      if (s.instructions != null) s.instructions!,
                                    ].join('\n'),
                                  ),
                                  trailing: Column(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    children: [Text(l.meals(s.meals)), if (s.cash > 0) Text(rs(context, s.cash))],
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
          ),
        ),
        if (_selected.isNotEmpty && board != null)
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: Row(
                children: [
                  Expanded(child: Text(l.selectedCount(_selected.length))),
                  if (board.routes.any((r) => r.status != 'DONE')) ...[
                    BusyButton(
                      expand: false,
                      outlined: true,
                      label: l.dispatchAddToRoute,
                      onPressed: () => _addTo(board),
                    ),
                    const SizedBox(width: 8),
                  ],
                  BusyButton(expand: false, label: l.dispatchCreateRoute, onPressed: () => _create(board)),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _CreateRouteDialog extends ConsumerStatefulWidget {
  const _CreateRouteDialog({required this.board, required this.orderIds});
  final DispatchBoard board;
  final List<String> orderIds;

  @override
  ConsumerState<_CreateRouteDialog> createState() => _CreateRouteDialogState();
}

class _CreateRouteDialogState extends ConsumerState<_CreateRouteDialog> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(
    text: 'Route ${widget.board.routes.length + 1} · ${KtmDates.serviceDay(widget.board.date)}',
  );
  String? _slot;
  String? _zone;
  String? _rider;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final b = widget.board;
    DropdownMenuItem<String?> none() => DropdownMenuItem<String?>(value: null, child: Text(l.dispatchNone));
    return AlertDialog(
      title: Text(l.dispatchCreateRoute),
      scrollable: true,
      content: Form(
        key: _form,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l.selectedCount(widget.orderIds.length)),
            const SizedBox(height: 12),
            TextFormField(
              controller: _name,
              maxLength: 80,
              decoration: InputDecoration(labelText: l.dispatchRouteName),
              validator: (v) => (v ?? '').trim().isEmpty ? l.required : null,
            ),
            DropdownButtonFormField<String?>(
              value: _slot,
              isExpanded: true,
              decoration: InputDecoration(labelText: l.dispatchSlot),
              items: [none(), for (final s in b.slots) DropdownMenuItem(value: s.id, child: Text(s.name))],
              onChanged: (v) => setState(() => _slot = v),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String?>(
              value: _zone,
              isExpanded: true,
              decoration: InputDecoration(labelText: l.dispatchZone),
              items: [none(), for (final z in b.zones) DropdownMenuItem(value: z.id, child: Text(z.name))],
              onChanged: (v) => setState(() => _zone = v),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String?>(
              value: _rider,
              isExpanded: true,
              decoration: InputDecoration(labelText: '${l.dispatchRider} (${l.optional})'),
              items: [
                none(),
                for (final r in b.riders)
                  DropdownMenuItem(
                    value: r.id,
                    child: Text(r.available ? r.name : '${r.name} (${l.dispatchUnavailable})'),
                  ),
              ],
              onChanged: (v) => setState(() => _rider = v),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l.cancel)),
        BusyButton(
          expand: false,
          label: l.dispatchCreateRoute,
          onPressed: () async {
            if (!_form.currentState!.validate()) return;
            final k = await _kitchenId(ref);
            if (k == null) return;
            await ref
                .read(dispatchRepositoryProvider)
                .createRoute(
                  kitchenId: k,
                  date: b.date.isNotEmpty ? b.date : ref.read(staffDateProvider),
                  name: _name.text.trim(),
                  slotId: _slot,
                  zoneId: _zone,
                  riderId: _rider,
                  orderIds: widget.orderIds,
                );
            if (context.mounted) Navigator.pop(context, true);
          },
        ),
      ],
    );
  }
}

// ───────────── Routes ─────────────

class _RoutesTab extends ConsumerWidget {
  const _RoutesTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    return ProviderBody<DispatchBoard>(
      provider: dispatchBoardProvider,
      builder:
          (context, b) =>
              b.routes.isEmpty
                  ? ScrollFill(child: EmptyView(message: l.dispatchNoRoutes, icon: Icons.alt_route_outlined))
                  : ListView.separated(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(16),
                    itemCount: b.routes.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (c, i) => _RouteCard(board: b, route: b.routes[i]),
                  ),
    );
  }
}

class _RouteCard extends ConsumerWidget {
  const _RouteCard({required this.board, required this.route});
  final DispatchBoard board;
  final DispatchRoute route;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final repo = ref.read(dispatchRepositoryProvider);
    void refresh() => ref.invalidate(dispatchBoardProvider);
    final r = route;
    return Card(
      child: ExpansionTile(
        shape: const Border(),
        title: Row(
          children: [
            Expanded(child: Text(r.name, style: const TextStyle(fontWeight: FontWeight.w700))),
            StatusChip(r.status),
          ],
        ),
        subtitle: Text(
          [
            if (r.slotLabel != null) r.slotLabel!,
            r.riderName ?? l.dispatchNoRider,
            l.orderCount(r.stops.length),
            if (r.cashExpected != null)
              l.dispatchCashExpected(rs(context, r.cashCollected ?? 0), rs(context, r.cashExpected)),
          ].where((s) => s.isNotEmpty).join(' · '),
        ),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        children: [
          for (final s in r.stops)
            ListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              leading: CircleAvatar(radius: 14, child: Text('${s.sequence}')),
              title: Text('${s.number} · ${s.contactName}'),
              subtitle: Text(
                [
                  s.placeName ?? s.area,
                  if (s.changed.isNotEmpty) '${l.dispatchChanged}: ${s.changed.join(', ')}',
                ].join('\n'),
              ),
              trailing:
                  r.status == 'DONE'
                      ? StatusChip(s.status)
                      : IconButton(
                        tooltip: l.dispatchRemoveStop,
                        icon: const Icon(Icons.remove_circle_outline),
                        onPressed: () async {
                          final ok = await confirmDialog(context, title: l.dispatchRemoveStop, body: s.number);
                          if (!ok) return;
                          try {
                            await repo.unassign(s.orderId);
                            refresh();
                          } catch (e) {
                            if (context.mounted) showError(context, e);
                          }
                        },
                      ),
            ),
          if (r.status != 'DONE')
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                BusyButton(
                  expand: false,
                  outlined: true,
                  icon: Icons.two_wheeler_outlined,
                  label: r.riderId == null ? l.dispatchAssignRider : (r.riderName ?? l.dispatchRider),
                  onPressed: () async {
                    const clear = Rider(id: '', name: '');
                    final picked = await pickFromList<Rider>(
                      context,
                      title: l.dispatchAssignRider,
                      items: [clear, ...board.riders],
                      label:
                          (x) =>
                              x.id.isEmpty
                                  ? l.dispatchNone
                                  : (x.available ? x.name : '${x.name} (${l.dispatchUnavailable})'),
                      selected: board.riders.where((x) => x.id == r.riderId).firstOrNull,
                    );
                    if (picked == null) return;
                    await repo.assignRider(r.id, picked.id.isEmpty ? null : picked.id);
                    refresh();
                  },
                ),
                if (r.status == 'PLANNED')
                  BusyButton(
                    expand: false,
                    icon: Icons.send_outlined,
                    label: l.dispatchStart,
                    onPressed: () async {
                      final res = await repo.startRoute(r.id);
                      refresh();
                      if (!context.mounted) return;
                      final extra = res.rejected.map((x) => '${x.id}: ${x.reason}').join('\n');
                      showSnack(
                        context,
                        [l.dispatchStarted(res.out, res.notPacked), if (extra.isNotEmpty) extra].join('\n'),
                      );
                    },
                  ),
                if (r.status == 'OUT')
                  BusyButton(
                    expand: false,
                    icon: Icons.flag_outlined,
                    label: l.dispatchComplete,
                    onPressed: () async {
                      await repo.completeRoute(r.id);
                      refresh();
                    },
                  ),
              ],
            ),
        ],
      ),
    );
  }
}

// ───────────── Failed ─────────────

class _FailedTab extends ConsumerWidget {
  const _FailedTab();

  Future<void> _resolve(BuildContext context, WidgetRef ref, FailedDelivery f, String action) async {
    final l = context.l10n;
    final reason = await promptText(
      context,
      title: action == 'RETRY' ? l.dispatchRetry : l.dispatchCancelCredit,
      label: action == 'CANCEL' ? '${l.reason} — ${l.dispatchCancelCreditBody}' : l.reason,
      minLength: 3,
      maxLength: 500,
    );
    if (reason == null) return;
    try {
      await ref.read(dispatchRepositoryProvider).resolveFailed(f.orderId, action, reason);
      ref.invalidate(failedDeliveriesProvider);
      ref.invalidate(dispatchBoardProvider);
      if (context.mounted) showSnack(context, l.dispatchResolved(f.number));
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    return ProviderBody<List<FailedDelivery>>(
      provider: failedDeliveriesProvider,
      builder:
          (context, list) =>
              list.isEmpty
                  ? ScrollFill(child: EmptyView(message: l.dispatchNoFailed, icon: Icons.check_circle_outline))
                  : ListView.separated(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(16),
                    itemCount: list.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (c, i) {
                      final f = list[i];
                      return SectionCard(
                        title: '${f.number} · ${f.contactName}',
                        trailing: const StatusChip('FAILED_DELIVERY'),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              [f.placeName ?? f.area, if (f.route != null) f.route!.name, f.contactPhone].join(' · '),
                            ),
                            if (f.reason != null) Text(l.dispatchFailedReason(f.reason!)),
                            if (f.failedAt != null)
                              Text(
                                KtmDates.timestamp(f.failedAt, locale: context.lang),
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            const SizedBox(height: 8),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                FilledButton.icon(
                                  onPressed: () => _resolve(context, ref, f, 'RETRY'),
                                  icon: const Icon(Icons.replay),
                                  label: Text(l.dispatchRetry),
                                ),
                                OutlinedButton.icon(
                                  onPressed: () => _resolve(context, ref, f, 'CANCEL'),
                                  icon: const Icon(Icons.cancel_outlined),
                                  label: Text(l.dispatchCancelCredit),
                                ),
                              ],
                            ),
                          ],
                        ),
                      );
                    },
                  ),
    );
  }
}
