import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format/dates.dart';
import '../../core/l10n.dart';
import '../../core/providers.dart';
import '../../core/theme/brand.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/states.dart';
import '../../models/customer.dart';
import '../auth/session.dart';
import 'customer_providers.dart';
import 'customer_shell.dart';

/// Today / upcoming meals, hand-off code while out for delivery, plan progress.
class CustomerHomeScreen extends ConsumerWidget {
  const CustomerHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final me = ref.watch(meProvider);
    final upcoming = ref.watch(upcomingOrdersProvider);
    final plans = ref.watch(subscriptionsProvider);
    final settings = ref.watch(settingsProvider).valueOrNull;
    Future<void> refresh() async {
      ref.invalidate(upcomingOrdersProvider);
      ref.invalidate(subscriptionsProvider);
      await Future.wait([
        ref.read(upcomingOrdersProvider.future).catchError((Object _) => <OrderSummary>[]),
        ref.read(subscriptionsProvider.future).catchError((Object _) => <SubscriptionSummary>[]),
      ]);
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(l.appName),
        actions: [
          if ((me?.appList.length ?? 0) > 1)
            IconButton(
              tooltip: l.switchApp,
              icon: const Icon(Icons.apps),
              onPressed: () {
                ref.read(sessionProvider.notifier).selectApp(null);
                context.go('/switch');
              },
            ),
          IconButton(tooltip: l.notifications, onPressed: () => context.push('/c/notifications'), icon: const Icon(Icons.notifications_none)),
          const CartButton(),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            Text(l.hello(me?.name.split(' ').first ?? ''), style: Theme.of(context).textTheme.headlineSmall),
            Text(l.tagline),
            if (settings?.maintenance ?? false) ...[
              const SizedBox(height: 12),
              Notice(settings!.maintenanceMessage ?? l.maintenance, tone: Tone.warn),
            ],
            if (me?.twoFactorSetupRequired ?? false) ...[
              const SizedBox(height: 12),
              Notice(l.twoFactorSetupBanner, tone: Tone.warn, action: TextButton(onPressed: () => context.push('/security/2fa'), child: Text(l.setUpNow))),
            ],
            const SizedBox(height: 16),
            upcoming.when(
              skipLoadingOnRefresh: true,
              loading: () => const LoadingView(),
              error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(upcomingOrdersProvider)),
              data: (orders) => _Upcoming(orders: orders),
            ),
            const SizedBox(height: 16),
            plans.maybeWhen(
              data: (subs) {
                final live = subs.where((s) => s.status == 'ACTIVE' || s.status == 'PAUSED' || s.status == 'PENDING_PAYMENT').toList();
                if (live.isEmpty) return const SizedBox.shrink();
                return SectionCard(
                  title: l.myPlans,
                  child: Column(
                    children: [
                      for (final s in live)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(s.planName),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const SizedBox(height: 6),
                              LinearProgressIndicator(value: s.progress, minHeight: 8, borderRadius: BorderRadius.circular(8)),
                              const SizedBox(height: 4),
                              Text(l.planProgress(s.mealsDelivered, s.mealsTotal)),
                            ],
                          ),
                          trailing: StatusChip(s.status),
                          onTap: () => context.push('/c/my-plan/${s.id}'),
                        ),
                    ],
                  ),
                );
              },
              orElse: () => const SizedBox.shrink(),
            ),
          ],
        ),
      ),
    );
  }
}

class _Upcoming extends StatelessWidget {
  const _Upcoming({required this.orders});
  final List<OrderSummary> orders;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    if (orders.isEmpty) {
      return SectionCard(
        title: l.upcomingMeals,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l.noUpcoming),
            const SizedBox(height: 12),
            FilledButton(onPressed: () => context.go('/c/menu'), child: Text(l.browseMenu)),
          ],
        ),
      );
    }
    final today = orders.where((o) => KtmDates.isToday(o.deliveryDate)).toList();
    final later = orders.where((o) => !KtmDates.isToday(o.deliveryDate)).take(6).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (today.isNotEmpty) ...[
          SectionCard(
            title: l.todaysLunch,
            child: Column(children: [for (final o in today) _OrderTile(o, highlight: true)]),
          ),
          const SizedBox(height: 16),
        ],
        if (later.isNotEmpty) SectionCard(title: l.upcomingMeals, child: Column(children: [for (final o in later) _OrderTile(o)])),
      ],
    );
  }
}

class _OrderTile extends StatelessWidget {
  const _OrderTile(this.o, {this.highlight = false});
  final OrderSummary o;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final day = KtmDates.isToday(o.deliveryDate)
        ? l.today
        : KtmDates.isTomorrow(o.deliveryDate)
            ? l.tomorrow
            : KtmDates.serviceDay(o.deliveryDate, locale: context.lang);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(o.items.map((i) => i.toString()).join(', ')),
          subtitle: Text([day, if (o.slotLabel != null) o.slotLabel!].join(' · ')),
          trailing: StatusChip(o.status),
          onTap: () => context.push('/c/order/${o.id}'),
        ),
        if (o.deliveryOtp != null) HandOffCode(code: o.deliveryOtp!),
      ],
    );
  }
}

/// The customer's own hand-off code (only sent while OUT_FOR_DELIVERY). Riders never see this.
class HandOffCode extends StatelessWidget {
  const HandOffCode({super.key, required this.code});
  final String code;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: BrandColors.haldiLight, borderRadius: BorderRadius.circular(12), border: Border.all(color: BrandColors.haldi, width: 2)),
      child: Row(
        children: [
          const Icon(Icons.key_rounded, color: BrandColors.ink),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l.handOffCode, style: const TextStyle(color: BrandColors.ink, fontWeight: FontWeight.w700)),
                Text(l.handOffHelp, style: const TextStyle(color: BrandColors.inkSoft, fontSize: 12)),
              ],
            ),
          ),
          Semantics(
            label: '${l.handOffCode} ${code.split('').join(' ')}',
            child: Text(code, style: const TextStyle(color: BrandColors.ink, fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: 4)),
          ),
        ],
      ),
    );
  }
}
