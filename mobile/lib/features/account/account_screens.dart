import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format/dates.dart';
import '../../core/format/money.dart';
import '../../core/api/api_exception.dart';
import '../../core/l10n.dart';
import '../../core/providers.dart';
import '../../core/theme/brand.dart';
import '../../core/validators.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/paged_list.dart';
import '../../core/widgets/states.dart';
import '../../models/customer.dart';
import '../auth/session.dart';
import '../customer/customer_providers.dart';
import '../shell/app_switcher.dart';

class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final me = ref.watch(meProvider);
    final walletOn = me?.flag('wallet') ?? false;
    Widget tile(IconData icon, String title, String route) =>
        ListTile(leading: Icon(icon), title: Text(title), trailing: const Icon(Icons.chevron_right), onTap: () => context.push(route));
    return Scaffold(
      appBar: AppBar(title: Text(l.accountTitle)),
      body: ListView(
        children: [
          if (me != null)
            ListTile(
              leading: const CircleAvatar(backgroundColor: BrandColors.haldi, foregroundColor: BrandColors.ink, child: Icon(Icons.person)),
              title: Text(me.name, style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text([me.email, me.phone, me.companyName].whereType<String>().join(' · ')),
            ),
          if ((me?.appList.length ?? 0) > 1)
            ListTile(
              leading: const Icon(Icons.apps),
              title: Text(l.switchApp),
              onTap: () {
                ref.read(sessionProvider.notifier).selectApp(null);
                context.go('/switch');
              },
            ),
          const Divider(),
          tile(Icons.location_on_outlined, l.addresses, '/c/addresses'),
          if (walletOn) tile(Icons.account_balance_wallet_outlined, l.wallet, '/c/wallet'),
          tile(Icons.receipt_outlined, l.payments, '/c/payments'),
          tile(Icons.notifications_none, l.notifications, '/c/notifications'),
          tile(Icons.card_giftcard, l.referrals, '/c/referrals'),
          tile(Icons.support_agent, l.support, '/c/support'),
          const Divider(),
          tile(Icons.badge_outlined, l.profile, '/c/profile'),
          tile(Icons.restaurant, l.foodPreferences, '/c/preferences'),
          tile(Icons.tune, l.notificationSettings, '/c/notification-prefs'),
          tile(Icons.translate, l.language, '/language'),
          tile(Icons.security, l.security, '/security/sessions'),
          tile(Icons.privacy_tip_outlined, l.privacy, '/c/privacy'),
          const Divider(),
          ListTile(leading: const Icon(Icons.logout), title: Text(l.signOut), onTap: () => signOutFlow(context, ref)),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

// ───────────── addresses ─────────────

String addressTypeLabel(AppLocalizations l, String t) => switch (t) {
      'HOME' => l.atHOME,
      'OFFICE' => l.atOFFICE,
      'SHOP' => l.atSHOP,
      'COLLEGE' => l.atCOLLEGE,
      'SITE' => l.atSITE,
      _ => l.atOTHER,
    };

class AddressesScreen extends ConsumerWidget {
  const AddressesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final repo = ref.watch(customerRepositoryProvider);
    Future<void> act(Future<void> Function() f) async {
      try {
        await f();
      } catch (e) {
        if (context.mounted) showError(context, e);
      }
      ref.invalidate(addressesProvider);
    }

    return Scaffold(
      appBar: AppBar(title: Text(l.addresses)),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          await context.push('/c/address/new');
          ref.invalidate(addressesProvider);
        },
        icon: const Icon(Icons.add_location_alt_outlined),
        label: Text(l.add),
      ),
      body: ProviderBody<List<Address>>(
        provider: addressesProvider,
        builder: (context, list) => list.isEmpty
            ? ScrollFill(child: EmptyView(message: l.addAddress, icon: Icons.location_off_outlined))
            : ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                children: [
                  for (final a in list)
                    Card(
                      margin: const EdgeInsets.only(bottom: 10),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(child: Text(a.label.isEmpty ? addressTypeLabel(l, a.type) : a.label, style: Theme.of(context).textTheme.titleMedium)),
                                if (a.isDefault) StatusChip('DEFAULT', label: l.defaultAddress, tone: Tone.info),
                              ],
                            ),
                            Text(a.oneLine),
                            Text('${a.recipientName} · ${a.phone}'),
                            const SizedBox(height: 6),
                            StatusChip(a.covered ? 'COVERED' : 'NOT', label: a.covered ? '${l.covered}${a.zoneName != null ? ' · ${a.zoneName}' : ''}' : l.notCovered, tone: a.covered ? Tone.good : Tone.bad),
                            Wrap(
                              children: [
                                TextButton(
                                  onPressed: () async {
                                    await context.push('/c/address/${a.id}', extra: a);
                                    ref.invalidate(addressesProvider);
                                  },
                                  child: Text(l.edit),
                                ),
                                if (!a.isDefault) TextButton(onPressed: () => act(() => repo.makeDefaultAddress(a.id)), child: Text(l.makeDefault)),
                                TextButton(
                                  onPressed: () async {
                                    if (await confirmDialog(context, title: l.deleteAddressConfirm, destructive: true, confirmLabel: l.delete)) {
                                      await act(() => repo.deleteAddress(a.id));
                                    }
                                  },
                                  child: Text(l.delete),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}

class AddressFormScreen extends ConsumerStatefulWidget {
  const AddressFormScreen({super.key, this.address});
  final Address? address;

  @override
  ConsumerState<AddressFormScreen> createState() => _AddressFormScreenState();
}

class _AddressFormScreenState extends ConsumerState<AddressFormScreen> {
  final _form = GlobalKey<FormState>();
  late final Address? a = widget.address;
  late final _label = TextEditingController(text: a?.label);
  late String _type = a?.type ?? 'OFFICE';
  late final _recipient = TextEditingController(text: a?.recipientName ?? ref.read(meProvider)?.name);
  late final _phone = TextEditingController(text: a?.phone ?? ref.read(meProvider)?.phone);
  late final _place = TextEditingController(text: a?.placeName);
  late final _line1 = TextEditingController(text: a?.line1);
  late final _area = TextEditingController(text: a?.area);
  late final _ward = TextEditingController(text: a?.ward?.toString());
  late final _municipality = TextEditingController(text: a?.municipality);
  late final _city = TextEditingController(text: a?.city ?? 'Kathmandu');
  late final _landmark = TextEditingController(text: a?.landmark);
  late final _instructions = TextEditingController(text: a?.instructions);
  late bool _default = a?.isDefault ?? false;
  Map<String, String> _fields = const {};
  String? _coverage;
  bool? _covered;

  @override
  void dispose() {
    for (final c in [_label, _recipient, _phone, _place, _line1, _area, _ward, _municipality, _city, _landmark, _instructions]) {
      c.dispose();
    }
    super.dispose();
  }

  String? _t(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();

  Address get _draft => Address(id: a?.id ?? '', area: _area.text.trim(), ward: int.tryParse(_ward.text), municipality: _t(_municipality), city: _city.text.trim());

  Future<void> _check() async {
    final l = context.l10n;
    if (_area.text.trim().isEmpty) return;
    final c = await ref.read(customerRepositoryProvider).coverageFor(_draft);
    if (!mounted) return;
    setState(() {
      _covered = c.serviceable;
      _coverage = c.serviceable
          ? [l.covered, if (c.zoneName != null) c.zoneName!, if (c.fee != null) '${l.deliveryFee} ${rs(context, c.fee)}'].join(' · ')
          : (c.reason ?? l.notCovered);
    });
  }

  Future<void> _save() async {
    final l = context.l10n;
    if (!_form.currentState!.validate()) return;
    setState(() => _fields = const {});
    final input = <String, Object?>{
      'label': _label.text.trim(),
      'type': _type,
      'recipientName': _recipient.text.trim(),
      'phone': _phone.text.trim(),
      'placeName': _t(_place),
      'line1': _line1.text.trim(),
      'area': _area.text.trim(),
      'ward': int.tryParse(_ward.text),
      'municipality': _t(_municipality),
      'city': _city.text.trim(),
      'landmark': _t(_landmark),
      'instructions': _t(_instructions),
      'isDefault': _default,
    };
    try {
      final (_, covered) = await ref.read(customerRepositoryProvider).saveAddress(input, id: a?.id);
      if (!mounted) return;
      showSnack(context, covered ? l.saved : '${l.saved} · ${l.notCovered}');
      context.pop();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _fields = e.fields);
      showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final v = Validators(l);
    InputDecoration dec(String label, String field) => InputDecoration(labelText: label, errorText: _fields[field]);
    const gap = SizedBox(height: 12);
    return Scaffold(
      appBar: AppBar(title: Text(a == null ? l.addAddress : l.edit)),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            DropdownButtonFormField<String>(
              value: _type,
              decoration: InputDecoration(labelText: l.addressType),
              items: [for (final t in const ['HOME', 'OFFICE', 'SHOP', 'COLLEGE', 'SITE', 'OTHER']) DropdownMenuItem(value: t, child: Text(addressTypeLabel(l, t)))],
              onChanged: (t) => setState(() => _type = t ?? _type),
            ),
            gap,
            TextFormField(controller: _label, maxLength: 40, decoration: dec(l.addressLabel, 'label')),
            TextFormField(controller: _recipient, decoration: dec(l.recipient, 'recipientName'), validator: v.required),
            gap,
            TextFormField(controller: _phone, keyboardType: TextInputType.phone, decoration: dec(l.phone, 'phone'), validator: v.phone),
            gap,
            TextFormField(controller: _place, decoration: dec('${l.placeName} (${l.optional})', 'placeName')),
            gap,
            TextFormField(controller: _line1, decoration: dec(l.line1, 'line1'), validator: v.required),
            gap,
            TextFormField(controller: _area, decoration: dec(l.area, 'area'), validator: v.required, onEditingComplete: _check),
            gap,
            Row(
              children: [
                SizedBox(width: 100, child: TextFormField(controller: _ward, keyboardType: TextInputType.number, decoration: dec(l.ward, 'ward'))),
                const SizedBox(width: 12),
                Expanded(child: TextFormField(controller: _municipality, decoration: dec(l.municipality, 'municipality'))),
              ],
            ),
            gap,
            TextFormField(controller: _city, decoration: dec(l.city, 'city'), validator: v.required),
            gap,
            TextFormField(controller: _landmark, decoration: dec('${l.landmark} (${l.optional})', 'landmark')),
            gap,
            TextFormField(controller: _instructions, maxLines: 2, decoration: dec('${l.instructions} (${l.optional})', 'instructions')),
            SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(l.makeDefault), value: _default, onChanged: (x) => setState(() => _default = x)),
            if (_coverage != null) Notice(_coverage!, tone: _covered == true ? Tone.good : Tone.bad),
            TextButton.icon(onPressed: _check, icon: const Icon(Icons.travel_explore), label: Text(l.checkCoverage)),
            const SizedBox(height: 8),
            BusyButton(label: l.save, onPressed: _save),
          ],
        ),
      ),
    );
  }
}

// ───────────── wallet + payments ─────────────

class WalletScreen extends ConsumerStatefulWidget {
  const WalletScreen({super.key});

  @override
  ConsumerState<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends ConsumerState<WalletScreen> {
  final _list = GlobalKey<PagedListState<LedgerEntry>>();

  Future<void> _topup(Wallet w) async {
    final l = context.l10n;
    final amountCtrl = TextEditingController();
    var method = w.topupMethods.firstOrNull ?? 'ESEWA';
    final res = await showDialog<(int, String)>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => AlertDialog(
          title: Text(l.topUp),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(controller: amountCtrl, autofocus: true, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: l.topUpAmount)),
              if (w.min != null && (w.maxNow ?? w.max) != null)
                Padding(padding: const EdgeInsets.only(top: 6), child: Text(l.topUpLimits(rs(context, w.min), rs(context, w.maxNow ?? w.max)), style: Theme.of(c).textTheme.bodySmall)),
              const SizedBox(height: 8),
              for (final m in w.topupMethods)
                RadioListTile<String>(contentPadding: EdgeInsets.zero, value: m, groupValue: method, title: Text(l.paymentMethod(m)), onChanged: (x) => set(() => method = x ?? method)),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c), child: Text(l.cancel)),
            FilledButton(
              onPressed: () {
                final p = Money.parse(amountCtrl.text);
                if (p == null || p <= 0) {
                  showSnack(context, l.invalidAmount);
                  return;
                }
                Navigator.pop(c, (p, method));
              },
              child: Text(l.continueLabel),
            ),
          ],
        ),
      ),
    );
    amountCtrl.dispose();
    if (res == null || !mounted) return;
    try {
      final r = await ref.read(customerRepositoryProvider).topup(res.$1, res.$2);
      if (!mounted) return;
      if (r.payment != null) await context.push('/c/pay/${r.payment!.id}');
    } catch (e) {
      if (mounted) showError(context, e);
    }
    ref.invalidate(walletProvider);
    await _list.currentState?.refresh();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final wallet = ref.watch(walletProvider);
    final topupFlag = ref.watch(meProvider)?.flag('walletTopup') ?? false;
    return Scaffold(
      appBar: AppBar(title: Text(l.wallet)),
      body: PagedList<LedgerEntry>(
        key: _list,
        fetch: (c) => ref.read(customerRepositoryProvider).ledger(cursor: c),
        onFirstPage: (_) => ref.invalidate(walletProvider),
        header: Padding(
          padding: const EdgeInsets.all(16),
          child: wallet.when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorView(error: e),
            data: (w) => SectionCard(
              title: l.walletBalance,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  MoneyText(w.balance, strong: true, style: Theme.of(context).textTheme.headlineMedium),
                  if (w.note != null) Text(w.note!, style: Theme.of(context).textTheme.bodySmall),
                  if (topupFlag && w.topupEnabled && w.topupMethods.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    FilledButton.icon(onPressed: () => _topup(w), icon: const Icon(Icons.add), label: Text(l.topUp)),
                  ],
                ],
              ),
            ),
          ),
        ),
        itemBuilder: (c, e) => ListTile(
          title: Text(e.reasonLabel),
          subtitle: Text([KtmDates.timestamp(e.createdAt, locale: context.lang), if (e.note != null) e.note!].join(' · ')),
          trailing: Text(
            '${e.amount > 0 ? '+' : ''}${rs(context, e.amount)}',
            style: TextStyle(fontWeight: FontWeight.w700, color: e.amount >= 0 ? BrandColors.saag : BrandColors.sindoor),
          ),
        ),
      ),
    );
  }
}

class PaymentsScreen extends ConsumerWidget {
  const PaymentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l.payments)),
      body: PagedList<PaymentListItem>(
        fetch: (c) => ref.read(customerRepositoryProvider).payments(cursor: c),
        itemBuilder: (c, p) => ListTile(
          title: Text('${l.paymentMethod(p.method)} · ${rs(context, p.amount)}'),
          subtitle: Text('${p.reference} · ${KtmDates.timestamp(p.paidAt ?? p.createdAt, locale: context.lang)}'),
          trailing: StatusChip(p.status),
          onTap: () => context.push('/c/pay/${p.id}'),
        ),
      ),
    );
  }
}

// ───────────── notifications ─────────────

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  final _list = GlobalKey<PagedListState<AppNotification>>();

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final repo = ref.read(customerRepositoryProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(l.notifications),
        actions: [
          TextButton(
            onPressed: () async {
              try {
                await repo.markRead();
                await _list.currentState?.refresh();
              } catch (e) {
                if (context.mounted) showError(context, e);
              }
            },
            child: Text(l.markAllRead),
          ),
        ],
      ),
      body: PagedList<AppNotification>(
        key: _list,
        fetch: (c) => repo.notifications(cursor: c),
        emptyMessage: l.noNotifications,
        emptyIcon: Icons.notifications_none,
        itemBuilder: (c, n) => ListTile(
          leading: Icon(n.unread ? Icons.circle : Icons.circle_outlined, size: 12, color: n.unread ? BrandColors.sindoor : null),
          title: Text(n.title, style: TextStyle(fontWeight: n.unread ? FontWeight.w700 : FontWeight.w400)),
          subtitle: Text([if (n.body != null) n.body!, KtmDates.timestamp(n.createdAt, locale: context.lang)].join('\n')),
          onTap: () async {
            if (n.unread) {
              await repo.markRead(id: n.id).catchError((Object _) {});
              await _list.currentState?.refresh();
            }
            final link = n.link ?? '';
            final order = RegExp(r'/orders/([A-Za-z0-9_-]+)').firstMatch(link);
            final plan = RegExp(r'/plans/([A-Za-z0-9_-]+)').firstMatch(link);
            if (!context.mounted) return;
            if (order != null) {
              await context.push('/c/order/${order.group(1)}');
            } else if (link.contains('/account/') && plan != null) {
              await context.push('/c/my-plan/${plan.group(1)}');
            }
          },
        ),
      ),
    );
  }
}

// ───────────── profile & preferences ─────────────

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _form = GlobalKey<FormState>();
  TextEditingController? _name;
  TextEditingController? _phone;
  TextEditingController? _email;
  bool _marketing = false;

  @override
  void dispose() {
    _name?.dispose();
    _phone?.dispose();
    _email?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final v = Validators(l);
    return Scaffold(
      appBar: AppBar(title: Text(l.profile)),
      body: ProviderBody<Profile>(
        provider: profileProvider,
        builder: (context, p) {
          if (_name == null) {
            _name = TextEditingController(text: p.name);
            _phone = TextEditingController(text: p.phone);
            _email = TextEditingController(text: p.email);
            _marketing = p.marketingOptIn;
          }
          return Form(
            key: _form,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              children: [
                TextFormField(controller: _name, decoration: InputDecoration(labelText: l.name), validator: v.required),
                const SizedBox(height: 12),
                TextFormField(controller: _email, enabled: p.canSetEmail, keyboardType: TextInputType.emailAddress, decoration: InputDecoration(labelText: l.email)),
                const SizedBox(height: 12),
                TextFormField(controller: _phone, keyboardType: TextInputType.phone, decoration: InputDecoration(labelText: l.phone, helperText: l.phoneChangeNote), validator: v.phone),
                SwitchListTile(contentPadding: EdgeInsets.zero, title: Text(l.marketingOptIn), value: _marketing, onChanged: (x) => setState(() => _marketing = x)),
                const SizedBox(height: 12),
                BusyButton(
                  label: l.save,
                  onPressed: () async {
                    if (!_form.currentState!.validate()) return;
                    await ref.read(customerRepositoryProvider).updateProfile({
                      'name': _name!.text.trim(),
                      if (_phone!.text.trim() != (p.phone ?? '')) 'phone': _phone!.text.trim(),
                      if (p.canSetEmail && _email!.text.trim().isNotEmpty) 'email': _email!.text.trim(),
                      'marketingOptIn': _marketing,
                    });
                    ref.invalidate(profileProvider);
                    await ref.read(sessionProvider.notifier).refreshMe();
                    if (context.mounted) showSnack(context, l.saved);
                  },
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

const allergenCodes = ['GLUTEN', 'DAIRY', 'EGG', 'SOY', 'PEANUT', 'TREE_NUT', 'SESAME', 'MUSTARD', 'FISH', 'SHELLFISH'];

class FoodPreferencesScreen extends ConsumerStatefulWidget {
  const FoodPreferencesScreen({super.key});

  @override
  ConsumerState<FoodPreferencesScreen> createState() => _FoodPreferencesScreenState();
}

class _FoodPreferencesScreenState extends ConsumerState<FoodPreferencesScreen> {
  FoodPreferences? _p;
  TextEditingController? _notes;

  @override
  void dispose() {
    _notes?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String dietName(String d) => switch (d) { 'ANY' => l.dietANY, 'EGG_OK' => l.dietEGG_OK, _ => l.dietLabel(d) };
    return Scaffold(
      appBar: AppBar(title: Text(l.foodPreferences)),
      body: ProviderBody<Profile>(
        provider: profileProvider,
        builder: (context, profile) {
          _p ??= profile.preferences;
          _notes ??= TextEditingController(text: profile.preferences.dietaryNotes);
          final p = _p!;
          void set(FoodPreferences n) => setState(() => _p = n);
          return ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(16),
            children: [
              Text(l.diet, style: Theme.of(context).textTheme.titleMedium),
              Wrap(
                spacing: 8,
                children: [
                  for (final d in const ['ANY', 'VEG', 'EGG_OK', 'VEGAN'])
                    ChoiceChip(
                      label: Text(dietName(d)),
                      selected: p.diet == d,
                      onSelected: (_) => set(FoodPreferences(diet: d, spiceTolerance: p.spiceTolerance, allergies: p.allergies, avoidOnionGarlic: p.avoidOnionGarlic)),
                    ),
                ],
              ),
              const SizedBox(height: 16),
              Text('${l.spiceTolerance}: ${p.spiceTolerance}/4', style: Theme.of(context).textTheme.titleMedium),
              Slider(
                value: p.spiceTolerance.toDouble(),
                max: 4,
                divisions: 4,
                label: '${p.spiceTolerance}',
                onChanged: (x) => set(FoodPreferences(diet: p.diet, spiceTolerance: x.round(), allergies: p.allergies, avoidOnionGarlic: p.avoidOnionGarlic)),
              ),
              Text(l.myAllergies, style: Theme.of(context).textTheme.titleMedium),
              Wrap(
                spacing: 8,
                runSpacing: 4,
                children: [
                  for (final a in allergenCodes)
                    FilterChip(
                      label: Text(humanize(a)),
                      selected: p.allergies.contains(a),
                      onSelected: (on) => set(
                        FoodPreferences(
                          diet: p.diet,
                          spiceTolerance: p.spiceTolerance,
                          allergies: on ? [...p.allergies, a] : p.allergies.where((x) => x != a).toList(),
                          avoidOnionGarlic: p.avoidOnionGarlic,
                        ),
                      ),
                    ),
                ],
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(l.avoidOnionGarlic),
                value: p.avoidOnionGarlic,
                onChanged: (x) => set(FoodPreferences(diet: p.diet, spiceTolerance: p.spiceTolerance, allergies: p.allergies, avoidOnionGarlic: x)),
              ),
              TextField(controller: _notes, maxLength: 300, maxLines: 3, decoration: InputDecoration(labelText: l.dietaryNotes)),
              const SizedBox(height: 12),
              BusyButton(
                label: l.save,
                onPressed: () async {
                  await ref.read(customerRepositoryProvider).updatePreferences(
                        FoodPreferences(diet: p.diet, spiceTolerance: p.spiceTolerance, allergies: p.allergies, avoidOnionGarlic: p.avoidOnionGarlic, dietaryNotes: _notes!.text.trim()),
                      );
                  ref.invalidate(profileProvider);
                  if (context.mounted) showSnack(context, l.saved);
                },
              ),
            ],
          );
        },
      ),
    );
  }
}

final notificationPrefsProvider = FutureProvider.autoDispose<NotificationPrefs>((ref) => ref.watch(customerRepositoryProvider).notificationPrefs());

class NotificationPrefsScreen extends ConsumerStatefulWidget {
  const NotificationPrefsScreen({super.key});

  @override
  ConsumerState<NotificationPrefsScreen> createState() => _NotificationPrefsScreenState();
}

class _NotificationPrefsScreenState extends ConsumerState<NotificationPrefsScreen> {
  Set<String>? _on;

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    String topic(String t) => switch (t) { 'ORDER_UPDATES' => l.ntORDER_UPDATES, 'PLAN_REMINDERS' => l.ntPLAN_REMINDERS, 'MARKETING' => l.ntMARKETING, _ => humanize(t) };
    String channel(String c) => switch (c) { 'IN_APP' => l.chIN_APP, 'EMAIL' => l.chEMAIL, 'SMS' => l.chSMS, _ => humanize(c) };
    return Scaffold(
      appBar: AppBar(title: Text(l.notificationSettings)),
      body: ProviderBody<NotificationPrefs>(
        provider: notificationPrefsProvider,
        builder: (context, prefs) {
          _on ??= {for (final p in prefs.preferences.where((p) => p.enabled)) '${p.topic}|${p.channel}'};
          final topics = prefs.topics.isEmpty ? const ['ORDER_UPDATES', 'PLAN_REMINDERS', 'MARKETING'] : prefs.topics;
          final channels = prefs.channels.isEmpty ? const ['IN_APP', 'EMAIL', 'SMS'] : prefs.channels;
          return ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(16),
            children: [
              for (final t in topics)
                SectionCard(
                  title: topic(t),
                  child: Column(
                    children: [
                      for (final c in channels)
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(channel(c)),
                          value: _on!.contains('$t|$c'),
                          onChanged: (x) => setState(() => x ? _on!.add('$t|$c') : _on!.remove('$t|$c')),
                        ),
                    ],
                  ),
                ),
              const SizedBox(height: 12),
              BusyButton(
                label: l.save,
                onPressed: () async {
                  await ref.read(customerRepositoryProvider).saveNotificationPrefs([
                    for (final t in topics)
                      for (final c in channels) NotificationPref(t, c, _on!.contains('$t|$c')),
                  ]);
                  if (context.mounted) showSnack(context, l.saved);
                },
              ),
            ],
          );
        },
      ),
    );
  }
}

/// Shows settings-driven contact info (used by Support).
String? supportContact(WidgetRef ref) {
  final s = ref.read(settingsProvider).valueOrNull;
  return [s?.contactPhone, s?.contactEmail].whereType<String>().join(' · ');
}
