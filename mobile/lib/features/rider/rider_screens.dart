import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/format/dates.dart';
import '../../core/l10n.dart';
import '../../core/theme/brand.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/states.dart';
import '../../models/ops.dart';
import '../kitchen/staff_common.dart';
import '../shell/app_switcher.dart';
import 'deliver_dialog.dart';

/// Day the rider is looking at (null = server default: today).
final riderDateProvider = StateProvider<String?>((ref) => null);

final riderDaysProvider = FutureProvider.autoDispose<RiderDays>((ref) => ref.watch(riderRepositoryProvider).days());

final riderRoutesProvider = FutureProvider.autoDispose<RiderRoutesDay>(
  (ref) => ref.watch(riderRepositoryProvider).routes(ref.watch(riderDateProvider)),
);

final riderRouteProvider = FutureProvider.autoDispose.family<RiderRouteDetail, String>(
  (ref, id) => ref.watch(riderRepositoryProvider).route(id),
);

/// Route /rider — today's routes with a date picker over the rider window.
class RiderHomeScreen extends ConsumerWidget {
  const RiderHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final days = ref.watch(riderDaysProvider).valueOrNull;
    final data = ref.watch(riderRoutesProvider).valueOrNull;
    final date = ref.watch(riderDateProvider) ?? data?.date ?? days?.window.today ?? KtmDates.today();
    final window = days?.window ?? data?.window;
    return Scaffold(
      appBar: AppBar(title: Text(l.riderRoutesTitle), actions: const [StaffActions()]),
      body: Column(
        children: [
          Material(
            color: Theme.of(context).colorScheme.surfaceContainerLow,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              child: Row(
                children: [
                  if (days != null)
                    Expanded(child: Text(l.riderRouteCount(days.routesOn(date)), overflow: TextOverflow.ellipsis))
                  else
                    const Spacer(),
                  DateStepper(
                    date: date,
                    first: window?.from,
                    last: window?.to,
                    onChanged: (d) => ref.read(riderDateProvider.notifier).state = d,
                  ),
                ],
              ),
            ),
          ),
          Expanded(
            child: ProviderBody<RiderRoutesDay>(
              provider: riderRoutesProvider,
              builder: (context, day) {
                if (day.routes.isEmpty) {
                  return ScrollFill(child: EmptyView(message: l.riderNoRoutes, icon: Icons.two_wheeler_outlined));
                }
                return ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(16),
                  itemCount: day.routes.length + (day.readOnly ? 1 : 0),
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (c, i) {
                    if (day.readOnly && i == 0) return Notice(l.riderReadOnly);
                    final r = day.routes[i - (day.readOnly ? 1 : 0)];
                    return _RouteCard(route: r);
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _RouteCard extends StatelessWidget {
  const _RouteCard({required this.route});
  final RiderRouteSummary route;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final progress = route.stops == 0 ? 0.0 : route.stopsDone / route.stops;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => context.push('/rider/route/${route.id}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text(route.name, style: Theme.of(context).textTheme.titleMedium)),
                  StatusChip(route.status),
                ],
              ),
              if (route.slotLabel != null || route.riderName != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    [
                      if (route.slotLabel != null) route.slotLabel!,
                      if (route.riderName != null) route.riderName!,
                    ].join(' · '),
                  ),
                ),
              const SizedBox(height: 10),
              LinearProgressIndicator(value: progress, minHeight: 6, borderRadius: BorderRadius.circular(6)),
              const SizedBox(height: 6),
              Row(
                children: [
                  Expanded(child: Text(l.riderStopsProgress(route.stopsDone, route.stops))),
                  if (route.cashCollected > 0) Text(l.riderCashCollected(rs(context, route.cashCollected))),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Route /rider/route/:id — ordered stops with call / navigate / deliver / fail, and finish.
class RiderRouteScreen extends ConsumerWidget {
  const RiderRouteScreen({super.key, required this.routeId});
  final String routeId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final provider = riderRouteProvider(routeId);
    final route = ref.watch(provider).valueOrNull;
    return Scaffold(
      appBar: AppBar(title: Text(route?.name ?? l.riderRoutesTitle), actions: const [StaffActions()]),
      body: ProviderBody<RiderRouteDetail>(
        provider: provider,
        builder:
            (context, r) => ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        [
                          KtmDates.serviceDay(r.date, locale: context.lang),
                          if (r.slotLabel != null) r.slotLabel!,
                        ].join(' · '),
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                    ),
                    StatusChip(r.status),
                  ],
                ),
                const SizedBox(height: 6),
                Text(l.riderCashCollected(rs(context, r.cashCollected))),
                if (r.readOnly) ...[const SizedBox(height: 10), Notice(l.riderReadOnly)],
                const SizedBox(height: 12),
                if (r.stops.isEmpty) EmptyView(message: l.riderNoRoutes),
                for (final s in r.stops) ...[_StopCard(route: r, stop: s), const SizedBox(height: 10)],
                if (!r.readOnly && r.status != 'DONE') ...[
                  const SizedBox(height: 8),
                  if (r.openStops > 0)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text(l.riderOpenStops(r.openStops), textAlign: TextAlign.center),
                    ),
                  BusyButton(
                    label: l.riderFinishRoute,
                    icon: Icons.flag_outlined,
                    onPressed:
                        r.canFinish
                            ? () async {
                              final ok = await confirmDialog(
                                context,
                                title: l.riderFinishRoute,
                                body: l.riderFinishConfirm,
                              );
                              if (!ok) return;
                              await ref.read(riderRepositoryProvider).finish(r.id);
                              ref.invalidate(provider);
                              ref.invalidate(riderRoutesProvider);
                              if (context.mounted) showSnack(context, l.riderRouteFinished);
                            }
                            : null,
                  ),
                ],
              ],
            ),
      ),
    );
  }
}

class _StopCard extends ConsumerWidget {
  const _StopCard({required this.route, required this.stop});
  final RiderRouteDetail route;
  final RiderStop stop;

  Future<void> _open(BuildContext context, Uri uri) async {
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication).catchError((Object _) => false);
    if (!ok && context.mounted) showSnack(context, context.l10n.riderCantOpen);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final theme = Theme.of(context);
    void refresh() {
      ref.invalidate(riderRouteProvider(route.id));
      ref.invalidate(riderRoutesProvider);
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(radius: 16, child: Text('${stop.sequence}', semanticsLabel: l.riderStop(stop.sequence))),
                const SizedBox(width: 10),
                Expanded(child: Text('${stop.number}  ·  ${stop.code}', style: theme.textTheme.titleSmall)),
                StatusChip(stop.status),
              ],
            ),
            const SizedBox(height: 8),
            Text(stop.contactName, style: theme.textTheme.titleMedium),
            Text(stop.addressText),
            if ((stop.instructions ?? '').isNotEmpty)
              Text('${l.riderInstructions}: ${stop.instructions}', style: theme.textTheme.bodySmall),
            if ((stop.allergenNote ?? '').isNotEmpty) ...[
              const SizedBox(height: 6),
              Notice('${l.riderAllergen}: ${stop.allergenNote}', tone: Tone.warn),
            ],
            const SizedBox(height: 6),
            Text(stop.items.map((i) => '${i.quantity}× ${i.name}').join(', '), style: theme.textTheme.bodySmall),
            if (stop.cashDue > 0) ...[
              const SizedBox(height: 6),
              Text(
                l.riderCollect(rs(context, stop.cashDue)),
                style: TextStyle(fontWeight: FontWeight.w700, color: theme.colorScheme.primary),
              ),
            ],
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (stop.contactPhone.isNotEmpty)
                  OutlinedButton.icon(
                    onPressed: () => _open(context, Uri(scheme: 'tel', path: stop.contactPhone)),
                    icon: const Icon(Icons.call_outlined),
                    label: Text(stop.contactPhoneDisplay.isNotEmpty ? stop.contactPhoneDisplay : l.call),
                  ),
                OutlinedButton.icon(
                  onPressed:
                      () => _open(
                        context,
                        Uri.https('www.google.com', '/maps/search/', {'api': '1', 'query': stop.addressText}),
                      ),
                  icon: const Icon(Icons.directions_outlined),
                  label: Text(l.navigate),
                ),
              ],
            ),
            if (stop.canAct && !route.readOnly) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: () async {
                        final ok = await DeliverDialog.show(
                          context,
                          stop: stop,
                          requires: route.requires,
                          onSubmit: (input) => ref.read(riderRepositoryProvider).deliver(stop.orderId, input),
                        );
                        if (ok) {
                          refresh();
                          if (context.mounted) showSnack(context, l.riderDelivered(stop.number));
                        }
                      },
                      icon: const Icon(Icons.check_circle_outline),
                      label: Text(l.riderDeliver),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () async {
                        final ok = await FailStopDialog.show(
                          context,
                          stop: stop,
                          reasons: route.failureReasons,
                          onSubmit:
                              (reason, detail) =>
                                  ref.read(riderRepositoryProvider).fail(stop.orderId, reason, detail: detail),
                        );
                        if (ok) {
                          refresh();
                          if (context.mounted) showSnack(context, l.riderFailed(stop.number));
                        }
                      },
                      icon: const Icon(Icons.report_problem_outlined),
                      label: Text(l.riderFail),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
