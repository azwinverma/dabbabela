import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format/dates.dart';
import '../../core/json.dart';
import '../../core/l10n.dart';
import '../../core/theme/brand.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/states.dart';
import '../../models/catalog.dart';
import '../../models/customer.dart';
import 'checkout_screens.dart';
import 'customer_providers.dart';

/// Browse plans + my plans.
class PlansScreen extends ConsumerWidget {
  const PlansScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final mine = ref.watch(subscriptionsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.plansTitle)),
      body: ProviderBody<List<Plan>>(
        provider: plansProvider,
        builder: (context, plans) => ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            ...mine.maybeWhen(
              data: (subs) => subs.isEmpty
                  ? <Widget>[]
                  : [
                      Text(l.myPlans, style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      for (final s in subs)
                        Card(
                          margin: const EdgeInsets.only(bottom: 8),
                          child: ListTile(
                            title: Text(s.planName),
                            subtitle: Text('${KtmDates.serviceDay(s.startDate, locale: context.lang)} – ${KtmDates.serviceDay(s.endDate, locale: context.lang)} · ${l.planProgress(s.mealsDelivered, s.mealsTotal)}'),
                            trailing: StatusChip(s.status),
                            onTap: () => context.push('/c/my-plan/${s.id}'),
                          ),
                        ),
                      const SizedBox(height: 16),
                    ],
              orElse: () => <Widget>[],
            ),
            if (plans.isEmpty) EmptyView(message: l.nothingHere),
            for (final p in plans)
              Card(
                margin: const EdgeInsets.only(bottom: 12),
                child: InkWell(
                  onTap: () => context.push('/c/plan/${p.slug}'),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(child: Text(p.name, style: Theme.of(context).textTheme.titleLarge)),
                            if (p.isPopular) StatusChip('POPULAR', label: l.popular, tone: Tone.warn),
                          ],
                        ),
                        if (p.tagline != null) Text(p.tagline!),
                        const SizedBox(height: 8),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            MoneyText(p.pricePerMeal, strong: true, style: Theme.of(context).textTheme.titleLarge),
                            const SizedBox(width: 6),
                            Text(l.perMeal),
                            if (p.compareAtPrice != null && p.compareAtPrice! > p.pricePerMeal) ...[
                              const SizedBox(width: 8),
                              Text(rs(context, p.compareAtPrice), style: const TextStyle(decoration: TextDecoration.lineThrough)),
                            ],
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text([l.minDays(p.minDaysPerWeek), if (p.includesDelivery) l.deliveryIncluded].join(' · ')),
                        for (final f in p.features.take(4)) Text('• $f'),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Plan detail + subscribe: start date, days, weeks, veg-only, address, slot, method, coupon → live quote → start.
class PlanDetailScreen extends ConsumerStatefulWidget {
  const PlanDetailScreen({super.key, required this.slug});
  final String slug;

  @override
  ConsumerState<PlanDetailScreen> createState() => _PlanDetailScreenState();
}

class _PlanDetailScreenState extends ConsumerState<PlanDetailScreen> {
  String? _start;
  Set<String> _days = {};
  int? _weeks;
  bool _veg = false;
  String? _addressId;
  String? _slotId;
  String? _method;
  String? _coupon;
  Future<PlanQuote>? _quote;
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  static const _weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  Json _input(PlanDetail d) => {
        'planId': d.plan.id,
        'startDate': _start,
        'days': _weekdays.where(_days.contains).toList(),
        'weeks': _weeks,
        'vegOnly': _veg,
        'addressId': _addressId,
        'couponCode': _coupon,
      };

  void _requote(PlanDetail d) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (!mounted || _start == null || _days.length < d.plan.minDaysPerWeek) return;
      final f = ref.read(customerRepositoryProvider).planQuote(_input(d));
      setState(() {
        _quote = f;
      });
    });
  }

  Future<void> _subscribe(PlanDetail d) async {
    final l = context.l10n;
    final res = await ref.read(customerRepositoryProvider).subscribe({..._input(d), 'slotId': _slotId, 'method': _method});
    ref.invalidate(subscriptionsProvider);
    ref.invalidate(upcomingOrdersProvider);
    if (!mounted) return;
    if (res.mustPay) {
      context.pushReplacement('/c/pay/${res.payment!.id}');
    } else {
      showSnack(context, l.planStarted);
      if (res.subscriptionId != null) {
        context.pushReplacement('/c/my-plan/${res.subscriptionId}');
      } else {
        context.go('/c/plans');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final addresses = ref.watch(addressesProvider).valueOrNull ?? const <Address>[];
    return Scaffold(
      appBar: AppBar(title: Text(l.plansTitle)),
      body: ProviderBody<PlanDetail>(
        provider: planDetailProvider(widget.slug),
        builder: (context, d) {
          final p = d.plan;
          if (_start == null && d.startDates.isNotEmpty) {
            _start = d.startDates.first;
            _weeks = p.weeksDefault;
            _days = {'MON', 'TUE', 'WED', 'THU', 'FRI'}.take(p.maxDaysPerWeek.clamp(p.minDaysPerWeek, 7)).toSet();
            _method = d.paymentMethods.firstOrNull;
            _addressId = addresses.where((a) => a.isDefault).firstOrNull?.id ?? addresses.firstOrNull?.id;
            WidgetsBinding.instance.addPostFrameCallback((_) => _requote(d));
          }
          return ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(16),
            children: [
              Text(p.name, style: Theme.of(context).textTheme.headlineSmall),
              if (p.description != null) Text(p.description!),
              const SizedBox(height: 8),
              Row(children: [MoneyText(p.pricePerMeal, strong: true), const SizedBox(width: 6), Text(l.perMeal)]),
              const SizedBox(height: 16),
              SectionCard(
                title: l.startDate,
                child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final s in d.startDates.take(10))
                      ChoiceChip(
                        label: Text(KtmDates.serviceDay(s, locale: context.lang)),
                        selected: _start == s,
                        onSelected: (_) {
                          setState(() => _start = s);
                          _requote(d);
                        },
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              SectionCard(
                title: '${l.deliveryDays} · ${l.minDays(p.minDaysPerWeek)}',
                child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final w in _weekdays)
                      FilterChip(
                        label: Text(l.weekday(w)),
                        selected: _days.contains(w),
                        onSelected: (on) {
                          setState(() => on ? _days.add(w) : _days.remove(w));
                          _requote(d);
                        },
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              SectionCard(
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(child: Text(l.weeks)),
                        IconButton(
                          tooltip: '-',
                          onPressed: (_weeks ?? 1) > p.weeksMin
                              ? () {
                                  setState(() => _weeks = (_weeks ?? 1) - 1);
                                  _requote(d);
                                }
                              : null,
                          icon: const Icon(Icons.remove_circle_outline),
                        ),
                        Text('${_weeks ?? p.weeksDefault}', style: Theme.of(context).textTheme.titleMedium),
                        IconButton(
                          tooltip: '+',
                          onPressed: (_weeks ?? 1) < p.weeksMax
                              ? () {
                                  setState(() => _weeks = (_weeks ?? 1) + 1);
                                  _requote(d);
                                }
                              : null,
                          icon: const Icon(Icons.add_circle_outline),
                        ),
                      ],
                    ),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(l.vegOnly),
                      value: _veg,
                      onChanged: (v) {
                        setState(() => _veg = v);
                        _requote(d);
                      },
                    ),
                    Text(l.chefRotation, style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              SectionCard(
                title: l.deliverTo,
                child: addresses.isEmpty
                    ? OutlinedButton.icon(
                        onPressed: () async {
                          await context.push('/c/address/new');
                          ref.invalidate(addressesProvider);
                        },
                        icon: const Icon(Icons.add_location_alt_outlined),
                        label: Text(l.addAddress),
                      )
                    : DropdownButtonFormField<String>(
                        isExpanded: true,
                        value: _addressId,
                        items: [for (final a in addresses) DropdownMenuItem(value: a.id, child: Text('${a.label.isEmpty ? a.type : a.label} — ${a.oneLine}', overflow: TextOverflow.ellipsis))],
                        onChanged: (v) {
                          setState(() => _addressId = v);
                          _requote(d);
                        },
                      ),
              ),
              if (d.slots.isNotEmpty) ...[
                const SizedBox(height: 12),
                SectionCard(
                  title: l.deliverySlot,
                  child: Wrap(
                    spacing: 8,
                    children: [
                      ChoiceChip(label: Text(l.anySlot), selected: _slotId == null, onSelected: (_) => setState(() => _slotId = null)),
                      for (final s in d.slots) ChoiceChip(label: Text(s.label), selected: _slotId == s.id, onSelected: (_) => setState(() => _slotId = s.id)),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 12),
              SectionCard(
                title: l.payWith,
                child: RadioGroupList(values: d.paymentMethods, selected: _method, label: l.paymentMethod, onChanged: (m) => setState(() => _method = m)),
              ),
              const SizedBox(height: 12),
              TextField(
                textCapitalization: TextCapitalization.characters,
                decoration: InputDecoration(labelText: '${l.coupon} (${l.optional})'),
                onSubmitted: (v) {
                  _coupon = v.trim().isEmpty ? null : v.trim();
                  _requote(d);
                },
              ),
              const SizedBox(height: 12),
              if (_quote != null)
                FutureBuilder<PlanQuote>(
                  future: _quote,
                  builder: (context, snap) {
                    if (snap.connectionState != ConnectionState.done) return const LoadingView();
                    if (snap.hasError) return ErrorView(error: snap.error!, onRetry: () => _requote(d));
                    final q = snap.data!;
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        PlanQuoteCard(quote: q),
                        const SizedBox(height: 16),
                        BusyButton(
                          label: l.subscribe,
                          onPressed: q.ok && _addressId != null && _method != null ? () => _subscribe(d) : null,
                        ),
                      ],
                    );
                  },
                ),
              if (p.skipText != null || p.cancelText != null) ...[
                const SizedBox(height: 16),
                SectionCard(title: l.policies, child: Text([p.skipText, p.cancelText].whereType<String>().join('\n\n'))),
              ],
              const SizedBox(height: 24),
            ],
          );
        },
      ),
    );
  }
}

class PlanQuoteCard extends StatelessWidget {
  const PlanQuoteCard({super.key, required this.quote});
  final PlanQuote quote;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final q = quote;
    final problems = q.meals.where((m) => m.problem != null).toList();
    return SectionCard(
      title: l.total,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (q.error != null) Notice(q.error!, tone: Tone.bad),
          if (q.addressProblem != null) Notice(q.addressProblem!, tone: Tone.bad),
          InfoRow(l.planMeals, '${q.mealsTotal} × ${rs(context, q.perMealEffective)}'),
          if (q.endDate != null) InfoRow(l.planEnds(KtmDates.serviceDay(q.endDate, locale: context.lang)), ''),
          for (final m in problems) Text('${KtmDates.serviceDay(m.date, locale: context.lang)}: ${m.problem}', style: const TextStyle(color: BrandColors.sindoor)),
          for (final c in q.closures) Text(c, style: Theme.of(context).textTheme.bodySmall),
          const Divider(height: 20),
          InfoRow(l.subtotal, rs(context, q.subtotal)),
          InfoRow(l.deliveryFee, q.deliveryFee == 0 ? l.free : rs(context, q.deliveryFee)),
          if (q.discount + q.couponDiscount + q.companyDiscount > 0) InfoRow(l.discount, '−${rs(context, q.discount + q.couponDiscount + q.companyDiscount)}'),
          InfoRow(l.total, rs(context, q.total), bold: true),
          if (q.customerShare != q.total) InfoRow(l.youPay, rs(context, q.customerShare), bold: true),
          if (q.savings > 0) InfoRow(l.savings, rs(context, q.savings)),
          if (q.couponError != null) Text(q.couponError!, style: const TextStyle(color: BrandColors.sindoor)),
        ],
      ),
    );
  }
}

/// One of my plans: meals (tap → order detail with skip / swap), pending swap payments, pause / resume / cancel,
/// renew, add a meal, change address.
class MyPlanScreen extends ConsumerWidget {
  const MyPlanScreen({super.key, required this.id});
  final String id;

  void _refresh(WidgetRef ref) {
    ref.invalidate(subscriptionProvider(id));
    ref.invalidate(subscriptionsProvider);
    ref.invalidate(upcomingOrdersProvider);
  }

  Future<void> _act(BuildContext context, WidgetRef ref, Future<String> Function() f) async {
    try {
      final msg = await f();
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
      appBar: AppBar(title: Text(l.myPlans)),
      body: ProviderBody<SubscriptionDetail>(
        provider: subscriptionProvider(id),
        builder: (context, s) {
          final delivered = s.meals.where((m) => m.status == 'DELIVERED').length;
          return ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(16),
            children: [
              Row(children: [Expanded(child: Text(s.planName, style: Theme.of(context).textTheme.headlineSmall)), StatusChip(s.status)]),
              Text('${s.reference} · ${KtmDates.serviceDay(s.startDate, locale: context.lang)} – ${KtmDates.serviceDay(s.endDate, locale: context.lang)}'),
              Text(s.days.map(l.weekday).join(', ')),
              if (s.pausedUntil != null) Text(l.pausedUntil(KtmDates.serviceDay(s.pausedUntil, locale: context.lang))),
              const SizedBox(height: 8),
              LinearProgressIndicator(value: s.meals.isEmpty ? 0 : delivered / s.meals.length, minHeight: 8, borderRadius: BorderRadius.circular(8)),
              Text(l.planProgress(delivered, s.meals.length)),
              const SizedBox(height: 12),
              if (s.isLive)
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    if (s.status == 'ACTIVE')
                      OutlinedButton.icon(
                        onPressed: () async {
                          final from = await showDatePicker(
                            context: context,
                            initialDate: KtmDates.parse(KtmDates.addDays(KtmDates.today(), 1))!,
                            firstDate: KtmDates.parse(KtmDates.today())!,
                            lastDate: KtmDates.parse(s.endDate) ?? KtmDates.parse(KtmDates.addDays(KtmDates.today(), 60))!,
                            helpText: l.pauseFrom,
                          );
                          if (from == null || !context.mounted) return;
                          await _act(context, ref, () => repo.pause(s.id, from: KtmDates.ymd(from)));
                        },
                        icon: const Icon(Icons.pause_circle_outline),
                        label: Text(l.pausePlan),
                      ),
                    if (s.status == 'PAUSED') FilledButton.icon(onPressed: () => _act(context, ref, () => repo.resume(s.id)), icon: const Icon(Icons.play_circle_outline), label: Text(l.resumePlan)),
                    OutlinedButton.icon(onPressed: () => _addMeal(context, ref, s), icon: const Icon(Icons.add), label: Text(l.addMeal)),
                    OutlinedButton.icon(onPressed: () => _changeAddress(context, ref, s), icon: const Icon(Icons.edit_location_alt_outlined), label: Text(l.changeAddress)),
                    OutlinedButton.icon(onPressed: () => _renew(context, ref, s), icon: const Icon(Icons.autorenew), label: Text(l.renewPlan)),
                    if (s.cancelPolicy != 'STAFF_ONLY')
                      OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(foregroundColor: BrandColors.sindoor),
                        onPressed: () async {
                          final reason = await promptText(context, title: l.cancelPlan, label: l.reason, minLength: 3, maxLength: 500, confirmLabel: l.cancelPlan);
                          if (reason != null && context.mounted) await _act(context, ref, () => repo.cancelPlan(s.id, reason));
                        },
                        icon: const Icon(Icons.cancel_outlined),
                        label: Text(l.cancelPlan),
                      ),
                  ],
                )
              else if (s.status == 'COMPLETED')
                OutlinedButton.icon(onPressed: () => _renew(context, ref, s), icon: const Icon(Icons.autorenew), label: Text(l.renewPlan)),
              if (s.pendingSwapPayments.isNotEmpty) ...[
                const SizedBox(height: 16),
                SectionCard(
                  title: l.pendingSwapPayments,
                  child: Column(
                    children: [
                      for (final p in s.pendingSwapPayments)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(p.str('reference', p.str('id'))),
                          subtitle: Text(rs(context, p.integer('amount'))),
                          trailing: FilledButton(onPressed: () => context.push('/c/pay/${p.str('id', p.str('paymentId'))}'), child: Text(l.payment)),
                        ),
                    ],
                  ),
                ),
              ],
              if (s.address != null) ...[
                const SizedBox(height: 16),
                SectionCard(title: l.deliverTo, child: Text(s.address!.oneLine)),
              ],
              const SizedBox(height: 16),
              SectionCard(
                title: l.planMeals,
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
                child: Column(
                  children: [
                    for (final m in s.meals)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(KtmDates.serviceDay(m.deliveryDate, locale: context.lang)),
                        subtitle: Text(m.items.map((i) => i.toString()).join(', ')),
                        trailing: StatusChip(m.status),
                        onTap: () => context.push('/c/order/${m.id}'),
                      ),
                  ],
                ),
              ),
              if (s.extraMeals.isNotEmpty) ...[
                const SizedBox(height: 12),
                SectionCard(
                  title: l.addMeal,
                  child: Column(
                    children: [
                      for (final e in s.extraMeals)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(KtmDates.serviceDay(e.str('deliveryDate'), locale: context.lang)),
                          trailing: StatusChip(e.str('status')),
                          onTap: () => context.push('/c/order/${e.str('id')}'),
                        ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 16),
              SectionCard(title: l.policies, child: Text([s.skipText, s.cancelText].where((t) => t.isNotEmpty).join('\n\n'))),
            ],
          );
        },
      ),
    );
  }

  Future<String?> _pickMethod(BuildContext context, List<String> methods) async {
    final l = context.l10n;
    return pickFromList<String>(context, title: l.payWith, items: methods, label: l.paymentMethod);
  }

  Future<void> _go(BuildContext context, WidgetRef ref, PurchaseResult r) async {
    _refresh(ref);
    if (r.mustPay && context.mounted) await context.push('/c/pay/${r.payment!.id}');
  }

  Future<void> _renew(BuildContext context, WidgetRef ref, SubscriptionDetail s) async {
    final l = context.l10n;
    final repo = ref.read(customerRepositoryProvider);
    try {
      final rq = await repo.renewalQuote(s.id);
      if (!context.mounted) return;
      if (rq.existingRenewal) {
        showSnack(context, l.renewalExists);
        return;
      }
      final ok = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text(l.renewPlan),
          content: SingleChildScrollView(child: PlanQuoteCard(quote: rq.quote)),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: Text(l.cancel)),
            FilledButton(onPressed: rq.quote.ok ? () => Navigator.pop(c, true) : null, child: Text(l.continueLabel)),
          ],
        ),
      );
      if (ok != true || !context.mounted) return;
      final plan = await ref.read(planDetailProvider(s.planSlug).future);
      if (!context.mounted) return;
      final method = await _pickMethod(context, plan.paymentMethods);
      if (method == null) return;
      final r = await repo.renew(s.id, method: method, weeks: rq.weeks, slotId: s.slotId);
      if (context.mounted) await _go(context, ref, r);
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  Future<void> _addMeal(BuildContext context, WidgetRef ref, SubscriptionDetail s) async {
    final l = context.l10n;
    final repo = ref.read(customerRepositoryProvider);
    try {
      final plan = await ref.read(planDetailProvider(s.planSlug).future);
      if (!context.mounted) return;
      final dates = plan.dayOptions.keys.where((d) => d.compareTo(KtmDates.today()) >= 0).toList()..sort();
      final date = await pickFromList<String>(context, title: l.pickDay, items: dates.take(14).toList(), label: (d) => KtmDates.serviceDay(d, locale: context.lang));
      if (date == null || !context.mounted) return;
      final opts = plan.dayOptions[date]!.where((o) => !o.soldOut && (!s.vegOnly || o.isVeg)).toList();
      final box = await pickFromList<PlanDayOption>(context, title: l.addMeal, items: opts, label: (o) => '${o.name} · ${rs(context, o.price)}');
      if (box == null || !context.mounted) return;
      final q = await repo.extraMealQuote(s.id, date, box.boxId);
      if (!context.mounted) return;
      final ok = await confirmDialog(context, title: '${q.str('name', box.name)} · ${KtmDates.serviceDay(date, locale: context.lang)}', body: '${l.total}: ${rs(context, q.integer('total'))}');
      if (!ok || !context.mounted) return;
      final method = await _pickMethod(context, plan.paymentMethods);
      if (method == null) return;
      final r = await repo.addMeal(s.id, date, box.boxId, method);
      if (context.mounted) await _go(context, ref, r);
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  Future<void> _changeAddress(BuildContext context, WidgetRef ref, SubscriptionDetail s) async {
    final l = context.l10n;
    final list = await ref.read(addressesProvider.future);
    if (!context.mounted) return;
    final a = await pickFromList<Address>(context, title: l.changeAddress, items: list, label: (a) => '${a.label.isEmpty ? a.type : a.label} — ${a.oneLine}');
    if (a == null || !context.mounted) return;
    await _act(context, ref, () => ref.read(customerRepositoryProvider).changePlanAddress(s.id, a.id));
  }
}
