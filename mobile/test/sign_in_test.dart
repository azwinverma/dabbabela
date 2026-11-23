import 'package:dabba_bela/features/auth/session.dart';
import 'package:dabba_bela/features/auth/sign_in_screen.dart';
import 'package:dabba_bela/models/auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'helpers.dart';

void main() {
  final settings = FakeReply.data({'flags': {'phoneOtp': false}, 'paymentMethods': ['CASH']});

  testWidgets('email + password → 2FA code step → token stored, /me loaded, routed by apps', (tester) async {
    final api = TestApi(
      routes({
        'GET /settings': (_) => settings,
        'POST /auth/sign-in': (r) => FakeReply.data({'twoFactorRequired': true, 'challengeToken': 'chal-1', 'token': null}),
        'POST /auth/two-factor/verify': (r) {
          final body = r.json! as Map;
          expect(body['challengeToken'], 'chal-1');
          expect(body['code'], '123456');
          return FakeReply.data({'token': 'tok-staff', 'user': {'id': 'u1', 'name': 'Hari', 'role': 'DELIVERY_AGENT'}});
        },
        'GET /me': (r) {
          expect(r.headers['Authorization'], 'Bearer tok-staff');
          return FakeReply.data(mePayload(role: 'DELIVERY_AGENT', rider: true));
        },
      }),
    );
    await tester.pumpWidget(testApp(const SignInScreen(), overrides: api.overrides));
    await tester.pumpAndSettle();

    // Client-side validation first.
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
    expect(find.text('Enter a valid email'), findsOneWidget);
    expect(api.adapter.requests.where((r) => r.path == '/auth/sign-in'), isEmpty);

    await tester.enterText(find.byKey(const Key('email')), 'hari@dabbabela.com');
    await tester.enterText(find.byKey(const Key('password')), 'correct horse');
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(find.text('Enter your authenticator code'), findsOneWidget);
    expect(find.byKey(const Key('code')), findsOneWidget);
    expect(await api.tokens.load(), isNull, reason: 'no token exists until the code is verified');

    await tester.enterText(find.byKey(const Key('code')), '123456');
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();

    expect(api.kv.values['db.session.token'], 'tok-staff');
    final container = ProviderScope.containerOf(tester.element(find.byType(SignInScreen)));
    final s = container.read(sessionProvider);
    expect(s.status, SessionStatus.signedIn);
    expect(s.me!.apps, {AppSection.customer, AppSection.rider});
    expect(s.activeApp, isNull, reason: 'several apps → switcher');
  });

  testWidgets('wrong password shows the server message; expired challenge restarts sign-in', (tester) async {
    var signIns = 0;
    final api = TestApi(
      routes({
        'GET /settings': (_) => settings,
        'POST /auth/sign-in': (r) {
          signIns++;
          return signIns == 1
              ? FakeReply.error(401, 'INVALID_CREDENTIALS', 'Wrong email or password')
              : FakeReply.data({'twoFactorRequired': true, 'challengeToken': 'c', 'token': null});
        },
        'POST /auth/two-factor/verify': (_) => FakeReply.error(401, 'INVALID_CHALLENGE', 'Start again'),
      }),
    );
    await tester.pumpWidget(testApp(const SignInScreen(), overrides: api.overrides));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('email')), 'sita@example.com');
    await tester.enterText(find.byKey(const Key('password')), 'nope');
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
    expect(find.text('Wrong email or password'), findsOneWidget);

    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('code')), '000000');
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
    expect(find.text('That sign-in expired. Please sign in again.'), findsOneWidget);
    expect(find.byKey(const Key('password')), findsOneWidget, reason: 'back on the password step');
  });

  testWidgets('customer without 2FA signs straight in', (tester) async {
    final api = TestApi(
      routes({
        'GET /settings': (_) => settings,
        'POST /auth/sign-in': (_) => FakeReply.data({'twoFactorRequired': false, 'token': 'tok-c', 'user': {'id': 'u1', 'name': 'Sita'}}),
        'GET /me': (_) => FakeReply.data(mePayload()),
      }),
    );
    await tester.pumpWidget(testApp(const SignInScreen(), overrides: api.overrides));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('email')), 'sita@example.com');
    await tester.enterText(find.byKey(const Key('password')), 'pass1234');
    await tester.tap(find.byKey(const Key('submit')));
    await tester.pumpAndSettle();
    final s = ProviderScope.containerOf(tester.element(find.byType(SignInScreen))).read(sessionProvider);
    expect(s.signedIn, isTrue);
    expect(s.activeApp, AppSection.customer);
  });
}
