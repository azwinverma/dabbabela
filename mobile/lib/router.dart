import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/l10n.dart';
import 'core/widgets/states.dart';
import 'features/account/account_screens.dart';
import 'features/account/support_screens.dart';
import 'features/auth/auth_screens.dart';
import 'features/auth/security_screens.dart';
import 'features/auth/session.dart';
import 'features/auth/sign_in_screen.dart';
import 'features/customer/checkout_screens.dart';
import 'features/customer/customer_shell.dart';
import 'features/customer/home_screen.dart';
import 'features/customer/menu_screens.dart';
import 'features/customer/order_screens.dart';
import 'features/customer/payment_screens.dart';
import 'features/customer/plan_screens.dart';
import 'features/dispatch/dispatch_screens.dart';
import 'features/kitchen/kitchen_screens.dart';
import 'features/rider/rider_screens.dart';
import 'features/shell/app_switcher.dart';
import 'models/auth.dart';
import 'models/customer.dart';

/// Which section a location belongs to (null = shared: switcher, security, language).
AppSection? sectionOf(String location) {
  if (location.startsWith('/c/')) return AppSection.customer;
  if (location == '/rider' || location.startsWith('/rider/')) return AppSection.rider;
  if (location == '/kitchen' || location.startsWith('/kitchen/')) return AppSection.kitchen;
  if (location == '/dispatch' || location.startsWith('/dispatch/')) return AppSection.dispatcher;
  return null;
}

/// Route guard: sign-in state, role routing from GET /me (`apps`), and per-section access. Pure — unit-tested.
String? sessionRedirect(SessionState s, String location) {
  final isAuth = location.startsWith('/auth/');
  final isPublic = isAuth || location == '/language';
  switch (s.status) {
    case SessionStatus.loading:
    case SessionStatus.error:
      return location == '/splash' ? null : '/splash';
    case SessionStatus.signedOut:
      return isPublic ? null : '/auth/sign-in';
    case SessionStatus.signedIn:
      break;
  }
  final me = s.me!;
  final home = s.activeApp != null ? homeFor(s.activeApp!) : (me.appList.length == 1 ? homeFor(me.appList.first) : '/switch');
  if (location == '/splash' || isAuth || location == '/') return home;
  final section = sectionOf(location);
  if (section != null && !me.apps.contains(section)) return home == location ? '/switch' : home;
  return null;
}

class _SessionListenable extends ChangeNotifier {
  _SessionListenable(this.value);
  SessionState value;
  void set(SessionState v) {
    value = v;
    notifyListeners();
  }
}

final _rootKey = GlobalKey<NavigatorState>();

final routerProvider = Provider<GoRouter>((ref) {
  final listenable = _SessionListenable(ref.read(sessionProvider));
  ref.listen<SessionState>(sessionProvider, (_, next) {
    listenable.set(next);
  });
  ref.onDispose(listenable.dispose);

  GoRoute page(String path, Widget Function(GoRouterState s) build) =>
      GoRoute(path: path, parentNavigatorKey: _rootKey, builder: (c, s) => build(s));

  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: '/splash',
    refreshListenable: listenable,
    redirect: (context, state) {
      final r = sessionRedirect(listenable.value, state.matchedLocation);
      if (r == null) {
        final section = sectionOf(state.matchedLocation);
        if (section != null && listenable.value.activeApp != section && listenable.value.signedIn) {
          Future.microtask(() => ref.read(sessionProvider.notifier).selectApp(section));
        }
      }
      return r;
    },
    routes: [
      GoRoute(path: '/splash', builder: (c, s) => const SplashScreen()),
      GoRoute(path: '/auth/sign-in', builder: (c, s) => const SignInScreen()),
      GoRoute(path: '/auth/sign-up', builder: (c, s) => const SignUpScreen()),
      GoRoute(path: '/auth/forgot', builder: (c, s) => const ForgotPasswordScreen()),
      GoRoute(path: '/auth/reset', builder: (c, s) => ResetPasswordScreen(token: s.uri.queryParameters['token'])),
      GoRoute(path: '/auth/otp', builder: (c, s) => const PhoneOtpScreen()),
      GoRoute(path: '/language', builder: (c, s) => const LanguageScreen()),
      GoRoute(path: '/switch', builder: (c, s) => const AppSwitcherScreen()),
      GoRoute(path: '/security/2fa', builder: (c, s) => const TotpEnrolScreen()),
      GoRoute(path: '/security/sessions', builder: (c, s) => const SessionsScreen()),

      // ── customer ──
      StatefulShellRoute.indexedStack(
        builder: (c, s, shell) => CustomerShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/c/home', builder: (c, s) => const CustomerHomeScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/c/menu', builder: (c, s) => const MenuScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/c/plans', builder: (c, s) => const PlansScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/c/orders', builder: (c, s) => const OrdersScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/c/account', builder: (c, s) => const AccountScreen())]),
        ],
      ),
      page('/c/box/:slug', (s) => BoxDetailScreen(slug: s.pathParameters['slug']!)),
      page('/c/cart', (s) => const CartScreen()),
      page('/c/checkout', (s) => const CheckoutScreen()),
      page('/c/pay/:id', (s) => PaymentScreen(paymentId: s.pathParameters['id']!)),
      page('/c/order/:id', (s) => OrderDetailScreen(orderId: s.pathParameters['id']!)),
      page('/c/plan/:slug', (s) => PlanDetailScreen(slug: s.pathParameters['slug']!)),
      page('/c/my-plan/:id', (s) => MyPlanScreen(id: s.pathParameters['id']!)),
      page('/c/addresses', (s) => const AddressesScreen()),
      page('/c/address/new', (s) => const AddressFormScreen()),
      page('/c/address/:id', (s) => AddressFormScreen(address: s.extra is Address ? s.extra! as Address : null)),
      page('/c/wallet', (s) => const WalletScreen()),
      page('/c/payments', (s) => const PaymentsScreen()),
      page('/c/notifications', (s) => const NotificationsScreen()),
      page('/c/referrals', (s) => const ReferralsScreen()),
      page('/c/support', (s) => const SupportScreen()),
      page('/c/support/new', (s) => NewTicketScreen(orderId: s.uri.queryParameters['orderId'])),
      page('/c/support/:id', (s) => TicketScreen(id: s.pathParameters['id']!)),
      page('/c/profile', (s) => const ProfileScreen()),
      page('/c/preferences', (s) => const FoodPreferencesScreen()),
      page('/c/notification-prefs', (s) => const NotificationPrefsScreen()),
      page('/c/privacy', (s) => const PrivacyScreen()),

      // ── staff ──
      GoRoute(path: '/rider', builder: (c, s) => const RiderHomeScreen()),
      GoRoute(path: '/rider/route/:id', builder: (c, s) => RiderRouteScreen(routeId: s.pathParameters['id']!)),
      GoRoute(path: '/kitchen', builder: (c, s) => const KitchenHomeScreen()),
      GoRoute(path: '/dispatch', builder: (c, s) => const DispatchHomeScreen()),
    ],
  );
});

/// Start-up: restoring the session; offline on start shows a retry (the token is kept).
class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Image.asset('assets/brand/logo-mark.png', width: 96, height: 96, semanticLabel: context.l10n.appName),
              const SizedBox(height: 16),
              Text(context.l10n.appName, style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 24),
              if (s.status == SessionStatus.error)
                ErrorView(error: s.error ?? 'Error', onRetry: () => ref.read(sessionProvider.notifier).restore())
              else
                const CircularProgressIndicator(),
            ],
          ),
        ),
      ),
    );
  }
}
