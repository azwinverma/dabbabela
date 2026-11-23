import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format/dates.dart';
import '../../core/l10n.dart';
import '../../core/providers.dart';
import '../../data/ops_repository.dart';
import '../../models/auth.dart';

/// Shared by the kitchen and dispatcher sections: repositories, the kitchen in scope and the service day.
final riderRepositoryProvider = Provider<RiderRepository>((ref) => RiderRepository(ref.watch(apiClientProvider)));
final kitchenRepositoryProvider = Provider<KitchenRepository>((ref) => KitchenRepository(ref.watch(apiClientProvider)));
final dispatchRepositoryProvider = Provider<DispatchRepository>((ref) => DispatchRepository(ref.watch(apiClientProvider)));

/// Kitchens in the caller's scope (GET /kitchen/kitchens).
final kitchensProvider = FutureProvider.autoDispose<List<KitchenRef>>((ref) => ref.watch(kitchenRepositoryProvider).kitchens());

/// The kitchen the user picked (remembered while the app runs). Null = first kitchen in scope.
final selectedKitchenIdProvider = StateProvider<String?>((ref) => null);

/// The effective kitchen: the picked one if still in scope, else the first.
final currentKitchenProvider = FutureProvider.autoDispose<KitchenRef?>((ref) async {
  final list = await ref.watch(kitchensProvider.future);
  final picked = ref.watch(selectedKitchenIdProvider);
  if (list.isEmpty) return null;
  return list.firstWhere((k) => k.id == picked, orElse: () => list.first);
});

/// Kathmandu service day shown by the kitchen and dispatch boards (defaults to today).
final staffDateProvider = StateProvider<String>((ref) => KtmDates.today());

/// Kitchen dropdown (only when there are several) + day switcher with a date picker.
class KitchenDateBar extends ConsumerWidget {
  const KitchenDateBar({super.key, this.showKitchen = true});

  final bool showKitchen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final kitchens = ref.watch(kitchensProvider).valueOrNull ?? const <KitchenRef>[];
    final current = ref.watch(currentKitchenProvider).valueOrNull;
    final date = ref.watch(staffDateProvider);
    return Material(
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
        child: Row(
          children: [
            if (showKitchen && kitchens.length > 1)
              Expanded(
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    isExpanded: true,
                    value: current?.id,
                    hint: Text(l.pickKitchen),
                    items: [for (final k in kitchens) DropdownMenuItem(value: k.id, child: Text(k.name, overflow: TextOverflow.ellipsis))],
                    onChanged: (v) => ref.read(selectedKitchenIdProvider.notifier).state = v,
                  ),
                ),
              )
            else if (showKitchen && current != null)
              Expanded(child: Text(current.name, style: Theme.of(context).textTheme.titleSmall, overflow: TextOverflow.ellipsis))
            else
              const Spacer(),
            DateStepper(
              date: date,
              onChanged: (d) => ref.read(staffDateProvider.notifier).state = d,
            ),
          ],
        ),
      ),
    );
  }
}

/// ‹ Mon, 24 Nov › with a calendar picker; [first]/[last] bound the range (YYYY-MM-DD).
class DateStepper extends StatelessWidget {
  const DateStepper({super.key, required this.date, required this.onChanged, this.first, this.last});

  final String date;
  final ValueChanged<String> onChanged;
  final String? first;
  final String? last;

  bool _inRange(String d) => (first == null || d.compareTo(first!) >= 0) && (last == null || d.compareTo(last!) <= 0);

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final prev = KtmDates.addDays(date, -1);
    final next = KtmDates.addDays(date, 1);
    final label = KtmDates.isToday(date)
        ? l.today
        : KtmDates.isTomorrow(date)
            ? l.tomorrow
            : KtmDates.serviceDay(date, locale: context.lang);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(tooltip: l.back, onPressed: _inRange(prev) ? () => onChanged(prev) : null, icon: const Icon(Icons.chevron_left)),
        TextButton.icon(
          icon: const Icon(Icons.calendar_today_outlined, size: 18),
          label: Text(label),
          onPressed: () async {
            final now = KtmDates.parse(KtmDates.today())!;
            final initial = KtmDates.parse(date) ?? now;
            final firstD = KtmDates.parse(first) ?? now.subtract(const Duration(days: 60));
            final lastD = KtmDates.parse(last) ?? now.add(const Duration(days: 30));
            final picked = await showDatePicker(
              context: context,
              helpText: l.pickDate,
              initialDate: initial.isBefore(firstD) ? firstD : (initial.isAfter(lastD) ? lastD : initial),
              firstDate: firstD,
              lastDate: lastD,
            );
            if (picked != null) onChanged(KtmDates.ymd(picked));
          },
        ),
        IconButton(tooltip: l.continueLabel, onPressed: _inRange(next) ? () => onChanged(next) : null, icon: const Icon(Icons.chevron_right)),
      ],
    );
  }
}

/// Small metric tile for summaries.
class StatTile extends StatelessWidget {
  const StatTile(this.label, this.value, {super.key, this.highlight = false});

  final String label;
  final String value;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      constraints: const BoxConstraints(minWidth: 96),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: highlight ? scheme.tertiaryContainer : scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(value, style: Theme.of(context).textTheme.headlineSmall),
          Text(label, style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}
