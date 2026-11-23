import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/config.dart';
import '../../core/format/dates.dart';
import '../../core/l10n.dart';
import '../../core/theme/brand.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/states.dart';
import '../../models/catalog.dart';
import 'customer_providers.dart';
import 'customer_shell.dart';

/// Weekly menu by date (the API already narrows it to the company menu for company members).
class MenuScreen extends ConsumerStatefulWidget {
  const MenuScreen({super.key});

  @override
  ConsumerState<MenuScreen> createState() => _MenuScreenState();
}

class _MenuScreenState extends ConsumerState<MenuScreen> {
  String? _selectedDate;

  void _shiftWeek(MenuWeek w, int days) {
    ref.read(menuWeekParamProvider.notifier).state = KtmDates.addDays(w.weekStart, days);
    setState(() => _selectedDate = null);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l.tabMenu), actions: const [CartButton()]),
      body: ProviderBody<MenuWeek>(
        provider: menuProvider,
        builder: (context, week) {
          final days = week.days;
          final selected = days.where((d) => d.date == _selectedDate).firstOrNull ??
              days.where((d) => d.orderable).firstOrNull ??
              days.where((d) => d.date.compareTo(KtmDates.today()) >= 0).firstOrNull ??
              days.firstOrNull;
          return CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(8, 0, 8, 0),
                  child: Row(
                    children: [
                      IconButton(tooltip: l.prevWeek, onPressed: () => _shiftWeek(week, -7), icon: const Icon(Icons.chevron_left)),
                      Expanded(
                        child: Text(
                          days.isEmpty ? week.weekStart : '${KtmDates.serviceDay(days.first.date, locale: context.lang)} – ${KtmDates.serviceDay(days.last.date, locale: context.lang)}',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                      ),
                      IconButton(tooltip: l.nextWeek, onPressed: () => _shiftWeek(week, 7), icon: const Icon(Icons.chevron_right)),
                    ],
                  ),
                ),
              ),
              if (week.companyMenuName != null)
                SliverToBoxAdapter(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4), child: Notice(l.companyMenu(week.companyMenuName!)))),
              if (!week.hasMenu || days.isEmpty)
                SliverFillRemaining(hasScrollBody: false, child: EmptyView(message: l.noMenu, icon: Icons.restaurant_menu))
              else ...[
                SliverToBoxAdapter(
                  child: SizedBox(
                    height: 64,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      children: [
                        for (final d in days)
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                            child: ChoiceChip(
                              key: ValueKey('day-${d.date}'),
                              label: Text(KtmDates.serviceDay(d.date, locale: context.lang)),
                              selected: d.date == selected?.date,
                              onSelected: (_) => setState(() => _selectedDate = d.date),
                              avatar: d.orderable ? null : const Icon(Icons.lock_outline, size: 16),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
                if (selected != null) ..._day(context, selected),
              ],
            ],
          );
        },
      ),
    );
  }

  List<Widget> _day(BuildContext context, MenuDay d) {
    final l = context.l10n;
    final status = d.closed ? l.kitchenClosed : (d.orderable ? (d.cutoff.isNotEmpty ? l.orderBy(d.cutoff) : '') : (d.problem ?? l.orderClosed));
    return [
      SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          child: Notice(
            [status, if (d.note != null) d.note!].where((s) => s.isNotEmpty).join(' · '),
            tone: d.orderable ? Tone.good : Tone.neutral,
            icon: d.orderable ? Icons.schedule : Icons.lock_outline,
          ),
        ),
      ),
      if (d.items.isEmpty)
        SliverToBoxAdapter(child: EmptyView(message: d.closed ? l.kitchenClosed : l.noMenu))
      else
        SliverList.builder(
          itemCount: d.items.length,
          itemBuilder: (c, i) => Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: MenuItemCard(day: d, item: d.items[i])),
        ),
    ];
  }
}

class MenuItemCard extends ConsumerWidget {
  const MenuItemCard({super.key, required this.day, required this.item});
  final MenuDay day;
  final MenuItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final b = item.box;
    final canAdd = day.orderable && !item.soldOut;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/c/box/${b.slug}'),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  BoxThumb(box: b),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Wrap(
                          spacing: 6,
                          runSpacing: 4,
                          children: [
                            if (item.isPrimary) StatusChip('PICK', label: l.chefsPick, tone: Tone.warn),
                            DietChip(box: b),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(b.name, style: Theme.of(context).textTheme.titleMedium),
                        if (b.tagline != null) Text(b.tagline!, maxLines: 2, overflow: TextOverflow.ellipsis),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  MoneyText(b.price, strong: true),
                  const SizedBox(width: 8),
                  if (item.soldOut)
                    StatusChip('SOLD_OUT', label: l.soldOut, tone: Tone.bad)
                  else if (item.remaining != null && item.remaining! <= 10)
                    StatusChip('LEFT', label: l.onlyLeft(item.remaining!), tone: Tone.warn),
                  const Spacer(),
                  FilledButton.tonal(
                    key: ValueKey('add-${b.id}-${day.date}'),
                    onPressed: canAdd
                        ? () {
                            ref.read(cartProvider.notifier).add(CartItem(boxId: b.id, slug: b.slug, name: b.name, date: day.date, unitPrice: b.price));
                            showSnack(context, l.addedToCart(b.name));
                          }
                        : null,
                    child: Text(l.add),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class DietChip extends StatelessWidget {
  const DietChip({super.key, required this.box});
  final PublicBox box;

  @override
  Widget build(BuildContext context) {
    if (box.diet.isEmpty) return const SizedBox.shrink();
    return StatusChip(box.diet, label: context.l10n.dietLabel(box.diet), tone: box.isVeg ? Tone.good : Tone.bad);
  }
}

/// Dish photo (website-relative or absolute URL) or a brand placeholder.
class BoxThumb extends StatelessWidget {
  const BoxThumb({super.key, required this.box, this.size = 72});
  final PublicBox box;
  final double size;

  @override
  Widget build(BuildContext context) {
    final img = box.image;
    final url = img == null || img.isEmpty ? null : (img.startsWith('http') ? img : '${AppConfig.siteOrigin}${img.startsWith('/') ? '' : '/'}$img');
    final placeholder = Container(
      width: size,
      height: size,
      color: BrandColors.momo,
      alignment: Alignment.center,
      child: const Icon(Icons.lunch_dining_rounded, color: BrandColors.sindoor, size: 32),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: url == null
          ? placeholder
          : Image.network(url, width: size, height: size, fit: BoxFit.cover, errorBuilder: (_, __, ___) => placeholder, semanticLabel: box.name),
    );
  }
}

/// One dabba: contents, allergens (with the caller's allergy hits), nutrition, swaps, orderable dates.
class BoxDetailScreen extends ConsumerStatefulWidget {
  const BoxDetailScreen({super.key, required this.slug});
  final String slug;

  @override
  ConsumerState<BoxDetailScreen> createState() => _BoxDetailScreenState();
}

class _BoxDetailScreenState extends ConsumerState<BoxDetailScreen> {
  String? _date;
  int _qty = 1;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(actions: const [CartButton()]),
      body: ProviderBody<BoxDetail>(
        provider: boxProvider(widget.slug),
        builder: (context, d) {
          final b = d.box;
          final open = d.dates.where((x) => !x.soldOut).toList();
          final date = _date ?? open.firstOrNull?.date;
          final price = d.dates.where((x) => x.date == date).firstOrNull?.price ?? b.price;
          final nutrition = d.box.nutrition.entries.where((e) => e.value is num).toList();
          return ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(16),
            children: [
              Center(child: BoxThumb(box: b, size: 160)),
              const SizedBox(height: 12),
              Wrap(spacing: 6, children: [DietChip(box: b), if (b.spice > 0) StatusChip('SPICE', label: l.spiceLevel(b.spice), tone: Tone.warn)]),
              const SizedBox(height: 6),
              Text(b.name, style: Theme.of(context).textTheme.headlineSmall),
              if (b.description != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(b.description!)),
              const SizedBox(height: 8),
              MoneyText(price, strong: true, style: Theme.of(context).textTheme.titleLarge),
              if (d.allergyHits.isNotEmpty) ...[
                const SizedBox(height: 12),
                Notice(l.allergyWarning(d.allergyHits.join(', ')), tone: Tone.bad),
              ],
              const SizedBox(height: 16),
              SectionCard(
                title: l.whatsInside,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [for (final i in b.items) Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Text(i.qty > 1 ? '• ${i.qty} × ${i.name}' : '• ${i.name}'))],
                ),
              ),
              const SizedBox(height: 12),
              SectionCard(
                title: l.allergens,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (b.allergens.isEmpty)
                      Text(l.noAllergens)
                    else
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          for (final a in b.allergens)
                            Chip(
                              label: Text(a.mayContain ? '${a.name} (${l.mayContain})' : a.name),
                              backgroundColor: d.allergyHits.contains(a.code) ? BrandColors.sindoorLight : null,
                            ),
                        ],
                      ),
                    const SizedBox(height: 8),
                    Text(l.sharedKitchen, style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
              if (nutrition.isNotEmpty) ...[
                const SizedBox(height: 12),
                SectionCard(
                  title: l.nutrition,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (final e in nutrition) InfoRow(humanize(e.key), '${e.value}'),
                      const SizedBox(height: 4),
                      Text(l.nutritionNote, style: Theme.of(context).textTheme.bodySmall),
                    ],
                  ),
                ),
              ],
              if (b.subs.isNotEmpty) ...[
                const SizedBox(height: 12),
                SectionCard(
                  title: l.swaps,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (final s in b.subs)
                        Text('• ${s.from} → ${s.to}${s.priceDelta != 0 ? ' (${s.priceDelta > 0 ? '+' : ''}${rs(context, s.priceDelta)})' : ''}'),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 16),
              Text(l.pickDay, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              if (d.offCompanyMenu)
                Notice(l.offCompanyMenu)
              else if (d.dates.isEmpty)
                Text(l.noDays)
              else
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final x in d.dates)
                      ChoiceChip(
                        label: Text(x.soldOut ? '${KtmDates.serviceDay(x.date, locale: context.lang)} · ${l.soldOut}' : KtmDates.serviceDay(x.date, locale: context.lang)),
                        selected: x.date == date,
                        onSelected: x.soldOut ? null : (_) => setState(() => _date = x.date),
                      ),
                  ],
                ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Text(l.quantity),
                  const Spacer(),
                  IconButton(onPressed: _qty > 1 ? () => setState(() => _qty--) : null, icon: const Icon(Icons.remove_circle_outline), tooltip: '-'),
                  Text('$_qty', style: Theme.of(context).textTheme.titleMedium),
                  IconButton(onPressed: _qty < 25 ? () => setState(() => _qty++) : null, icon: const Icon(Icons.add_circle_outline), tooltip: '+'),
                ],
              ),
              const SizedBox(height: 8),
              FilledButton.icon(
                onPressed: date == null || d.offCompanyMenu
                    ? null
                    : () {
                        ref.read(cartProvider.notifier).add(CartItem(boxId: b.id, slug: b.slug, name: b.name, date: date, unitPrice: price, qty: _qty));
                        showSnack(context, l.addedToCart(b.name));
                      },
                icon: const Icon(Icons.add_shopping_cart),
                label: Text(l.addToCart),
              ),
              const SizedBox(height: 24),
            ],
          );
        },
      ),
    );
  }
}
