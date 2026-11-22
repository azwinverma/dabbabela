import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/l10n.dart';
import '../../core/theme/brand.dart';
import '../../core/widgets/common.dart';
import '../../models/auth.dart';
import '../auth/session.dart';

/// Home route for each app section.
String homeFor(AppSection app) {
  switch (app) {
    case AppSection.customer:
      return '/c/home';
    case AppSection.rider:
      return '/rider';
    case AppSection.kitchen:
      return '/kitchen';
    case AppSection.dispatcher:
      return '/dispatch';
  }
}

String appLabel(AppLocalizations l, AppSection a) => switch (a) {
      AppSection.customer => l.appCustomer,
      AppSection.rider => l.appRider,
      AppSection.kitchen => l.appKitchen,
      AppSection.dispatcher => l.appDispatcher,
    };

IconData appIcon(AppSection a) => switch (a) {
      AppSection.customer => Icons.lunch_dining_rounded,
      AppSection.rider => Icons.two_wheeler_rounded,
      AppSection.kitchen => Icons.soup_kitchen_rounded,
      AppSection.dispatcher => Icons.alt_route_rounded,
    };

/// Shown after sign-in to users with more than one app section (staff always also have "customer").
class AppSwitcherScreen extends ConsumerWidget {
  const AppSwitcherScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final me = ref.watch(meProvider);
    if (me == null) return const SizedBox.shrink();
    String hint(AppSection a) => switch (a) {
          AppSection.customer => l.appCustomerHint,
          AppSection.rider => l.appRiderHint,
          AppSection.kitchen => l.appKitchenHint,
          AppSection.dispatcher => l.appDispatcherHint,
        };
    return Scaffold(
      appBar: AppBar(
        title: Text(l.appName),
        actions: [IconButton(tooltip: l.signOut, onPressed: () => signOutFlow(context, ref), icon: const Icon(Icons.logout))],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(me.name, style: Theme.of(context).textTheme.headlineSmall),
          if (me.roleLabel.isNotEmpty) Text(me.roleLabel),
          const SizedBox(height: 16),
          if (me.twoFactorSetupRequired) ...[
            Notice(
              l.twoFactorSetupBanner,
              tone: Tone.warn,
              icon: Icons.shield_outlined,
              action: TextButton(onPressed: () => context.push('/security/2fa'), child: Text(l.setUpNow)),
            ),
            const SizedBox(height: 16),
          ],
          Text(l.chooseApp, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          for (final a in me.appList)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Card(
                child: ListTile(
                  key: ValueKey('app-${a.name}'),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  leading: CircleAvatar(backgroundColor: BrandColors.haldi, foregroundColor: BrandColors.ink, child: Icon(appIcon(a))),
                  title: Text(appLabel(l, a), style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text(hint(a)),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () {
                    ref.read(sessionProvider.notifier).selectApp(a);
                    context.go(homeFor(a));
                  },
                ),
              ),
            ),
        ],
      ),
    );
  }
}

Future<void> signOutFlow(BuildContext context, WidgetRef ref) async {
  final l = context.l10n;
  final ok = await confirmDialog(context, title: l.signOut, body: l.signOutConfirm, confirmLabel: l.signOut);
  if (ok) await ref.read(sessionProvider.notifier).signOut();
}

/// App-bar actions every staff screen shows: switch app (when the user has several) and sign out.
class StaffActions extends ConsumerWidget {
  const StaffActions({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final me = ref.watch(meProvider);
    return PopupMenuButton<String>(
      tooltip: l.switchApp,
      icon: const Icon(Icons.account_circle_outlined),
      onSelected: (v) {
        if (v == 'switch') {
          ref.read(sessionProvider.notifier).selectApp(null);
          context.go('/switch');
        } else if (v == 'security') {
          context.push('/security/sessions');
        } else if (v == 'lang') {
          context.push('/language');
        } else if (v == 'out') {
          signOutFlow(context, ref);
        }
      },
      itemBuilder: (c) => [
        if (me != null) PopupMenuItem(enabled: false, child: Text(me.name)),
        if ((me?.appList.length ?? 0) > 1) PopupMenuItem(value: 'switch', child: Text(l.switchApp)),
        PopupMenuItem(value: 'lang', child: Text(l.language)),
        PopupMenuItem(value: 'security', child: Text(l.sessionsTitle)),
        PopupMenuItem(value: 'out', child: Text(l.signOut)),
      ],
    );
  }
}
