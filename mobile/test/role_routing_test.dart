import 'package:dabba_bela/app.dart';
import 'package:dabba_bela/core/json.dart';
import 'package:dabba_bela/features/auth/session.dart';
import 'package:dabba_bela/models/auth.dart';
import 'package:dabba_bela/router.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'helpers.dart';

SessionState signedIn(Map<String, Object?> me, {AppSection? active}) =>
    SessionState(status: SessionStatus.signedIn, me: Me.fromJson(asJson(me)), activeApp: active);

void main() {
  group('sessionRedirect (role routing from GET /me)', () {
    test('loading / offline start → splash; signed out → sign-in (auth pages stay public)', () {
      const loading = SessionState(status: SessionStatus.loading);
      expect(sessionRedirect(loading, '/c/home'), '/splash');
      expect(sessionRedirect(loading, '/splash'), isNull);
      const out = SessionState(status: SessionStatus.signedOut);
      expect(sessionRedirect(out, '/c/home'), '/auth/sign-in');
      expect(sessionRedirect(out, '/auth/forgot'), isNull);
      expect(sessionRedirect(out, '/language'), isNull);
    });

    test('customer-only account lands on the customer home and cannot open staff sections', () {
      final s = signedIn(mePayload(), active: AppSection.customer);
      expect(sessionRedirect(s, '/splash'), '/c/home');
      expect(sessionRedirect(s, '/auth/sign-in'), '/c/home');
      expect(sessionRedirect(s, '/rider'), '/c/home');
      expect(sessionRedirect(s, '/kitchen'), '/c/home');
      expect(sessionRedirect(s, '/dispatch'), '/c/home');
      expect(sessionRedirect(s, '/c/orders'), isNull);
    });

    test('staff with several apps get the switcher; each allowed section opens', () {
      final s = signedIn(mePayload(role: 'KITCHEN_MANAGER', kitchen: true, dispatcher: true));
      expect(sessionRedirect(s, '/splash'), '/switch');
      expect(sessionRedirect(s, '/kitchen'), isNull);
      expect(sessionRedirect(s, '/dispatch'), isNull);
      expect(sessionRedirect(s, '/rider'), '/switch', reason: 'not a rider');
      expect(sessionRedirect(s, '/c/menu'), isNull, reason: 'customer is always on');
    });

    test('rider with an active section goes straight to routes', () {
      final s = signedIn(mePayload(role: 'DELIVERY_AGENT', rider: true), active: AppSection.rider);
      expect(sessionRedirect(s, '/splash'), '/rider');
      expect(sessionRedirect(s, '/rider/route/r1'), isNull);
    });

    test('staff still enrolling 2FA: staff sections are off (apps false) → customer only', () {
      final s = signedIn(mePayload(role: 'DELIVERY_AGENT', setupRequired: true));
      expect(s.me!.twoFactorSetupRequired, isTrue);
      expect(sessionRedirect(s, '/splash'), '/c/home');
      expect(sessionRedirect(s, '/rider'), '/c/home');
      expect(sessionRedirect(s, '/security/2fa'), isNull);
    });
  });

  testWidgets('app start with a stored token: GET /me → switcher for a rider, then into the rider app', (tester) async {
    final api = TestApi(
      routes({
        'GET /me': (_) => FakeReply.data(mePayload(role: 'DELIVERY_AGENT', rider: true)),
        'GET /settings': (_) => FakeReply.data({'flags': <String, Object>{}}),
        'GET /rider/days': (_) => FakeReply.data({'window': {'from': '2026-11-08', 'to': '2026-11-29', 'today': '2026-11-22'}, 'days': <Object>[]}),
        'GET /rider/routes': (_) => FakeReply.data({'date': '2026-11-22', 'window': {'from': '2026-11-08', 'to': '2026-11-29', 'today': '2026-11-22'}, 'readOnly': false, 'routes': <Object>[]}),
      }),
      token: 'stored-token',
    );
    await tester.pumpWidget(ProviderScope(overrides: api.overrides, child: const DabbaBelaApp()));
    await tester.pumpAndSettle();

    expect(find.text('Where do you want to go?'), findsOneWidget);
    expect(find.byKey(const ValueKey('app-customer')), findsOneWidget);
    expect(find.byKey(const ValueKey('app-rider')), findsOneWidget);
    expect(find.byKey(const ValueKey('app-kitchen')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('app-rider')));
    await tester.pumpAndSettle();
    final container = ProviderScope.containerOf(tester.element(find.byType(Scaffold).first));
    expect(container.read(sessionProvider).activeApp, AppSection.rider);
    expect(api.adapter.requests.any((r) => r.path == '/rider/routes'), isTrue);
  });

  testWidgets('a 401 on any call drops the token and shows sign-in', (tester) async {
    final api = TestApi(
      routes({
        'GET /me': (_) => FakeReply.error(401, 'UNAUTHENTICATED', 'Session expired'),
        'GET /settings': (_) => FakeReply.data({'flags': <String, Object>{}}),
      }),
      token: 'expired-token',
    );
    await tester.pumpWidget(ProviderScope(overrides: api.overrides, child: const DabbaBelaApp()));
    await tester.pumpAndSettle();
    expect(find.text('Welcome back'), findsOneWidget);
    expect(api.kv.values.containsKey('db.session.token'), isFalse);
  });
}
