import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format/dates.dart';
import '../../core/json.dart';
import '../../core/l10n.dart';
import '../../core/theme/brand.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/states.dart';
import '../../models/auth.dart';
import '../../models/ops.dart';
import '../shell/app_switcher.dart';
import 'staff_common.dart';

final productionProvider = FutureProvider.autoDispose<Production>((ref) async {
  final k = await ref.watch(currentKitchenProvider.future);
  return ref.watch(kitchenRepositoryProvider).production(k?.id, ref.watch(staffDateProvider));
});

final batchesProvider = FutureProvider.autoDispose<BatchDay>((ref) async {
  final k = await ref.watch(currentKitchenProvider.future);
  return ref.watch(kitchenRepositoryProvider).batches(k?.id, ref.watch(staffDateProvider));
});

final qcProvider = FutureProvider.autoDispose<List<QcCheck>>((ref) async {
  final k = await ref.watch(currentKitchenProvider.future);
  return ref.watch(kitchenRepositoryProvider).qc(k?.id, ref.watch(staffDateProvider));
});

final stockAlertsProvider = FutureProvider.autoDispose<List<StockAlert>>((ref) async {
  final k = await ref.watch(currentKitchenProvider.future);
  return ref.watch(kitchenRepositoryProvider).stockAlerts(k?.id);
});

/// Route /kitchen — production, batches, QC and stock alerts for a kitchen-day.
class KitchenHomeScreen extends ConsumerWidget {
  const KitchenHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final kitchens = ref.watch(kitchensProvider);
    return DefaultTabController(
      length: 4,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l.appKitchen),
          actions: const [StaffActions()],
          bottom: TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [Tab(text: l.kitchenProduction), Tab(text: l.kitchenBatches), Tab(text: l.kitchenQc), Tab(text: l.kitchenAlerts)],
          ),
        ),
        body: AsyncView<List<KitchenRef>>(
          value: kitchens,
          onRetry: () => ref.invalidate(kitchensProvider),
          data: (list) => list.isEmpty
              ? EmptyView(message: l.noKitchens, icon: Icons.soup_kitchen_outlined)
              : const Column(
                  children: [
                    KitchenDateBar(),
                    Expanded(child: TabBarView(children: [_ProductionTab(), _BatchesTab(), _QcTab(), _AlertsTab()])),
                  ],
                ),
        ),
      ),
    );
  }
}

// ───────────── Production ─────────────

class _ProductionTab extends ConsumerStatefulWidget {
  const _ProductionTab();

  @override
  ConsumerState<_ProductionTab> createState() => _ProductionTabState();
}

class _ProductionTabState extends ConsumerState<_ProductionTab> {
  final Set<String> _selected = {};

  Future<void> _start() async {
    final l = context.l10n;
    final r = await ref.read(kitchenRepositoryProvider).start(_selected.toList());
    if (!mounted) return;
    _report(l.kitchenChanged(r.changed.length), r.rejected.map((x) => '${x.id}: ${x.reason}').toList());
    setState(_selected.clear);
    ref.invalidate(productionProvider);
  }

  Future<void> _pack(Production p) async {
    final l = context.l10n;
    final ok = await showDialog<bool>(context: context, builder: (_) => const _PackChecksDialog());
    if (ok != true || !mounted) return;
    final r = await ref.read(kitchenRepositoryProvider).pack(_selected.toList());
    if (!mounted) return;
    final numbers = {for (final o in p.orderList) o.id: o.number};
    _report(
      l.kitchenChanged(r.packed),
      r.results.where((x) => !x.packed).map((x) => '${x.number ?? numbers[x.orderId] ?? x.orderId}: ${x.reason ?? ''}').toList(),
    );
    setState(_selected.clear);
    ref.invalidate(productionProvider);
  }

  void _report(String headline, List<String> rejected) {
    if (rejected.isEmpty) {
      showSnack(context, headline);
      return;
    }
    showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(headline),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [Text(context.l10n.kitchenRejected, style: const TextStyle(fontWeight: FontWeight.w700)), for (final r in rejected) Text('• $r')],
          ),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(c), child: Text(context.l10n.close))],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final p = ref.watch(productionProvider).valueOrNull;
    return Column(
      children: [
        Expanded(
          child: ProviderBody<Production>(
            provider: productionProvider,
            builder: (context, p) => ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              children: [
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    StatTile(l.kitchenOrders, '${p.orders}'),
                    StatTile(l.kitchenMeals, '${p.meals}', highlight: true),
                    StatTile(l.kitchenPendingPayment, '${p.pendingPayment}'),
                    StatTile(l.kitchenAllergenFlagged, '${p.allergenFlagged}'),
                  ],
                ),
                const SizedBox(height: 12),
                if (p.boxes.isNotEmpty)
                  SectionCard(
                    title: l.kitchenByDabba,
                    child: Column(children: [for (final b in p.boxes) InfoRow(b.name, '${b.meals}')]),
                  ),
                if (p.mealsBySlot.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  SectionCard(
                    title: l.kitchenBySlot,
                    child: Column(children: [for (final e in p.mealsBySlot.entries) InfoRow(e.key, '${e.value}')]),
                  ),
                ],
                if (p.dishes.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  SectionCard(
                    title: l.kitchenDishes,
                    child: Column(
                      children: [
                        for (final d in p.dishes)
                          InfoRow(d.station.isEmpty ? d.name : '${d.name} · ${d.station}', l.kitchenPortions(d.portions, d.buffer, d.total)),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(child: Text(l.kitchenOrders, style: Theme.of(context).textTheme.titleMedium)),
                    if (p.orderList.isNotEmpty)
                      TextButton(
                        onPressed: () => setState(() {
                          if (_selected.length == p.orderList.length) {
                            _selected.clear();
                          } else {
                            _selected
                              ..clear()
                              ..addAll(p.orderList.map((o) => o.id));
                          }
                        }),
                        child: Text(l.selectAll),
                      ),
                  ],
                ),
                if (p.orderList.isEmpty) EmptyView(message: l.kitchenNoOrders) else Text(l.kitchenSelectOrders, style: Theme.of(context).textTheme.bodySmall),
                for (final o in p.orderList)
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
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text([o.customerName, if (o.slotLabel != null) o.slotLabel!, o.placeName ?? o.area].join(' · ')),
                        Text(o.items.map((i) => '${i.quantity}× ${i.name}${i.customizations.isEmpty ? '' : ' (${i.customizations.join(', ')})'}').join(', ')),
                        if (o.hasAllergenFlag)
                          Text(
                            '⚠ ${[...o.allergenContains, if (o.allergenNote != null) o.allergenNote!].join(' · ')}',
                            style: const TextStyle(color: BrandColors.sindoor, fontWeight: FontWeight.w600),
                          ),
                        if (o.lastPackingOk == false && (o.lastPackingNote ?? '').isNotEmpty) Text(o.lastPackingNote!),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
        if (_selected.isNotEmpty && p != null)
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: Row(
                children: [
                  Expanded(child: Text(l.selectedCount(_selected.length))),
                  BusyButton(label: l.kitchenStartPreparing, expand: false, outlined: true, onPressed: _start),
                  const SizedBox(width: 8),
                  BusyButton(label: l.kitchenPack, expand: false, onPressed: () => _pack(p)),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _PackChecksDialog extends StatefulWidget {
  const _PackChecksDialog();

  @override
  State<_PackChecksDialog> createState() => _PackChecksDialogState();
}

class _PackChecksDialogState extends State<_PackChecksDialog> {
  final _checks = [false, false, false, false];

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final labels = [l.kitchenCheckItems, l.kitchenCheckLabel, l.kitchenCheckAllergen, l.kitchenCheckSealed];
    return AlertDialog(
      title: Text(l.kitchenPackChecksTitle),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(l.kitchenPackChecksBody),
          for (var i = 0; i < 4; i++)
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _checks[i],
              title: Text(labels[i]),
              onChanged: (v) => setState(() => _checks[i] = v ?? false),
            ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l.cancel)),
        FilledButton(onPressed: _checks.every((c) => c) ? () => Navigator.pop(context, true) : null, child: Text(l.kitchenPack)),
      ],
    );
  }
}

// ───────────── Batches ─────────────

class _BatchesTab extends ConsumerWidget {
  const _BatchesTab();

  Future<void> _advance(BuildContext context, WidgetRef ref, Batch b, String to) async {
    final l = context.l10n;
    final repo = ref.read(kitchenRepositoryProvider);
    if (to == 'DONE') {
      final res = await showDialog<(int?, int?)>(context: context, builder: (_) => _PortionsDialog(planned: b.plannedPortions + b.bufferPortions));
      if (res == null) return;
      await repo.advanceBatch(b.id, 'DONE', actualPortions: res.$1, wastePortions: res.$2);
    } else if (to == 'CANCELLED') {
      if (!context.mounted) return;
      final notes = await promptText(context, title: l.kitchenCancelBatch, label: l.note, minLength: 3);
      if (notes == null) return;
      await repo.advanceBatch(b.id, 'CANCELLED', notes: notes);
    } else {
      await repo.advanceBatch(b.id, to);
    }
    ref.invalidate(batchesProvider);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    return ProviderBody<BatchDay>(
      provider: batchesProvider,
      builder: (context, day) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          BusyButton(
            label: l.kitchenPlanBatches,
            icon: Icons.auto_awesome_outlined,
            outlined: true,
            onPressed: () async {
              final k = await ref.read(currentKitchenProvider.future);
              if (k == null) return;
              final r = await ref.read(kitchenRepositoryProvider).planBatches(k.id, ref.read(staffDateProvider));
              ref.invalidate(batchesProvider);
              if (context.mounted) showSnack(context, l.kitchenPlanned(r.integer('created'), r.integer('updated')));
            },
          ),
          const SizedBox(height: 12),
          if (day.batches.isEmpty) EmptyView(message: l.kitchenNoBatches, icon: Icons.outdoor_grill_outlined),
          for (final b in day.batches)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: SectionCard(
                title: b.dish,
                trailing: StatusChip(b.status),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text([if (b.station != null) b.station!, l.kitchenBatchPortions(b.plannedPortions, b.bufferPortions)].join(' · ')),
                    if (b.actualPortions != null) Text('${l.kitchenActualPortions}: ${b.actualPortions}  ·  ${l.kitchenWastePortions}: ${b.wastePortions ?? 0}'),
                    if ((b.notes ?? '').isNotEmpty) Text(b.notes!, style: Theme.of(context).textTheme.bodySmall),
                    if (b.nextStatus != null) ...[
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          BusyButton(
                            expand: false,
                            label: b.nextStatus == 'COOKING' ? l.kitchenStartCooking : l.kitchenMarkDone,
                            onPressed: () => _advance(context, ref, b, b.nextStatus!),
                          ),
                          BusyButton(expand: false, outlined: true, label: l.kitchenCancelBatch, onPressed: () => _advance(context, ref, b, 'CANCELLED')),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
          if (day.shortages.isNotEmpty)
            SectionCard(
              title: l.kitchenShortages,
              child: Column(
                children: [
                  for (final s in day.shortages)
                    InfoRow('${s.name} (${s.dish})', '${s.shortage.toStringAsFixed(s.shortage % 1 == 0 ? 0 : 2)} ${s.unit}'),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _PortionsDialog extends StatefulWidget {
  const _PortionsDialog({required this.planned});
  final int planned;

  @override
  State<_PortionsDialog> createState() => _PortionsDialogState();
}

class _PortionsDialogState extends State<_PortionsDialog> {
  late final _actual = TextEditingController(text: '${widget.planned}');
  final _waste = TextEditingController(text: '0');

  @override
  void dispose() {
    _actual.dispose();
    _waste.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final digits = [FilteringTextInputFormatter.digitsOnly];
    return AlertDialog(
      title: Text(l.kitchenMarkDone),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(controller: _actual, keyboardType: TextInputType.number, inputFormatters: digits, decoration: InputDecoration(labelText: l.kitchenActualPortions)),
          const SizedBox(height: 12),
          TextField(controller: _waste, keyboardType: TextInputType.number, inputFormatters: digits, decoration: InputDecoration(labelText: l.kitchenWastePortions)),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(l.cancel)),
        FilledButton(
          onPressed: () => Navigator.pop<(int?, int?)>(context, (int.tryParse(_actual.text), int.tryParse(_waste.text))),
          child: Text(l.save),
        ),
      ],
    );
  }
}

// ───────────── QC ─────────────

const qcTypes = ['TEMPERATURE', 'TASTE', 'HYGIENE', 'PACKAGING', 'OTHER'];

String qcTypeLabel(AppLocalizations l, String t) => switch (t) {
      'TEMPERATURE' => l.qcTEMPERATURE,
      'TASTE' => l.qcTASTE,
      'HYGIENE' => l.qcHYGIENE,
      'PACKAGING' => l.qcPACKAGING,
      'OTHER' => l.qcOTHER,
      _ => humanize(t),
    };

class _QcTab extends ConsumerWidget {
  const _QcTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final ok = await showDialog<bool>(context: context, builder: (_) => const _QcDialog());
          if (ok == true) ref.invalidate(qcProvider);
        },
        icon: const Icon(Icons.add),
        label: Text(l.kitchenLogQc),
      ),
      body: ProviderBody<List<QcCheck>>(
        provider: qcProvider,
        builder: (context, checks) => checks.isEmpty
            ? ScrollFill(child: EmptyView(message: l.kitchenNoQc, icon: Icons.fact_check_outlined))
            : ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(0, 8, 0, 96),
                itemCount: checks.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (c, i) {
                  final q = checks[i];
                  return ListTile(
                    title: Text([qcTypeLabel(l, q.type), if (q.dish != null) q.dish!, if (q.value != null) q.value!].join(' · ')),
                    subtitle: Text([KtmDates.timestamp(q.createdAt, locale: context.lang), if (q.note != null) q.note!].join('\n')),
                    trailing: StatusChip(q.result, label: q.result == 'PASS' ? l.kitchenQcPass : l.kitchenQcFail),
                  );
                },
              ),
      ),
    );
  }
}

class _QcDialog extends ConsumerStatefulWidget {
  const _QcDialog();

  @override
  ConsumerState<_QcDialog> createState() => _QcDialogState();
}

class _QcDialogState extends ConsumerState<_QcDialog> {
  final _form = GlobalKey<FormState>();
  final _value = TextEditingController();
  final _note = TextEditingController();
  String _type = 'TEMPERATURE';
  String _result = 'PASS';

  @override
  void dispose() {
    _value.dispose();
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return AlertDialog(
      title: Text(l.kitchenLogQc),
      scrollable: true,
      content: Form(
        key: _form,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            DropdownButtonFormField<String>(
              value: _type,
              decoration: InputDecoration(labelText: l.kitchenQcType),
              items: [for (final t in qcTypes) DropdownMenuItem(value: t, child: Text(qcTypeLabel(l, t)))],
              onChanged: (v) => setState(() => _type = v ?? _type),
            ),
            const SizedBox(height: 12),
            SegmentedButton<String>(
              segments: [
                ButtonSegment(value: 'PASS', label: Text(l.kitchenQcPass), icon: const Icon(Icons.check)),
                ButtonSegment(value: 'FAIL', label: Text(l.kitchenQcFail), icon: const Icon(Icons.close)),
              ],
              selected: {_result},
              onSelectionChanged: (s) => setState(() => _result = s.first),
            ),
            const SizedBox(height: 12),
            TextFormField(controller: _value, maxLength: 60, decoration: InputDecoration(labelText: '${l.kitchenQcValue} (${l.optional})')),
            TextFormField(
              controller: _note,
              maxLength: 500,
              maxLines: 2,
              decoration: InputDecoration(labelText: _result == 'FAIL' ? l.note : '${l.note} (${l.optional})'),
              validator: (v) => _result == 'FAIL' && (v ?? '').trim().isEmpty ? l.kitchenQcNoteRequired : null,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l.cancel)),
        BusyButton(
          expand: false,
          label: l.save,
          onPressed: () async {
            if (!_form.currentState!.validate()) return;
            final k = await ref.read(currentKitchenProvider.future);
            if (k == null) return;
            await ref.read(kitchenRepositoryProvider).logQc(
                  kitchenId: k.id,
                  date: ref.read(staffDateProvider),
                  type: _type,
                  result: _result,
                  value: _value.text.trim(),
                  note: _note.text.trim(),
                );
            if (context.mounted) Navigator.pop(context, true);
          },
        ),
      ],
    );
  }
}

// ───────────── Stock alerts ─────────────

class _AlertsTab extends ConsumerWidget {
  const _AlertsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    return ProviderBody<List<StockAlert>>(
      provider: stockAlertsProvider,
      builder: (context, alerts) => alerts.isEmpty
          ? ScrollFill(child: EmptyView(message: l.kitchenNoAlerts, icon: Icons.inventory_2_outlined))
          : ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              itemCount: alerts.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (c, i) {
                final a = alerts[i];
                final tone = switch (a.severity) { 'critical' => Tone.bad, 'warning' => Tone.warn, _ => Tone.info };
                return Notice(a.message.isEmpty ? humanize(a.type) : a.message, tone: tone);
              },
            ),
    );
  }
}
