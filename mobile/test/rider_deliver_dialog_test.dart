import 'dart:convert';
import 'dart:typed_data';

import 'package:dabba_bela/core/api/api_client.dart';
import 'package:dabba_bela/core/api/idempotency.dart';
import 'package:dabba_bela/core/json.dart';
import 'package:dabba_bela/core/l10n.dart';
import 'package:dabba_bela/core/storage/secure_store.dart';
import 'package:dabba_bela/data/ops_repository.dart';
import 'package:dabba_bela/features/rider/deliver_dialog.dart';
import 'package:dabba_bela/models/ops.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Records requests and answers with a canned envelope.
class _FakeAdapter implements HttpClientAdapter {
  final List<RequestOptions> requests = [];
  final List<String> bodies = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    bodies.add(requestStream == null ? '' : utf8.decode(await requestStream.expand((b) => b).toList()));
    return ResponseBody.fromString(
      jsonEncode({
        'data': {
          'orderId': 'o1',
          'number': 'DB-1001',
          'status': 'DELIVERED',
          'paymentStatus': 'PAID',
          'photoUrl': null,
        },
      }),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

// The payload deliberately carries a `deliveryOtp` (as a buggy/older server might): the app must never show it.
final _stop = RiderStop.fromJson(
  asJson(
    jsonDecode('''
{"sequence":1,"orderId":"o1","number":"DB-1001","code":"K3","status":"OUT_FOR_DELIVERY","canAct":true,"placeName":"Leapfrog",
 "addressLine":"Tower 2","area":"Baneshwor","ward":10,"contactName":"Ram","contactPhone":"9800000001","items":[],
 "paymentMethod":"CASH","paymentStatus":"PENDING","cashDue":45000,"deliveryOtp":"4321"}'''),
  ),
);

Widget _app(Widget child) => MaterialApp(
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: Scaffold(body: Center(child: child)),
);

void main() {
  testWidgets('OTP must be 4 digits, cash is prefilled, submits the typed code + cash; hand-off code never shown', (
    tester,
  ) async {
    final submitted = <DeliverInput>[];
    bool? result;
    await tester.pumpWidget(
      _app(
        Builder(
          builder:
              (context) => FilledButton(
                onPressed: () async {
                  result = await DeliverDialog.show(
                    context,
                    stop: _stop,
                    requires: const DeliverRequirements(otp: true),
                    onSubmit: (input) async => submitted.add(input),
                  );
                },
                child: const Text('open'),
              ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    // Never pre-filled with (or showing) the customer's code.
    expect(find.textContaining('4321'), findsNothing);
    final otpField = tester.widget<TextField>(
      find.descendant(of: find.byKey(const Key('deliver-otp')), matching: find.byType(TextField)),
    );
    expect(otpField.controller!.text, isEmpty);

    // Cash prefilled with the amount due.
    expect(find.text('Collect Rs 450 in cash'), findsOneWidget);
    final cashField = tester.widget<TextField>(
      find.descendant(of: find.byKey(const Key('deliver-cash')), matching: find.byType(TextField)),
    );
    expect(cashField.controller!.text, '450');

    await tester.enterText(find.byKey(const Key('deliver-otp')), '123');
    await tester.tap(find.byKey(const Key('deliver-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Enter the 4-digit code'), findsOneWidget);
    expect(submitted, isEmpty);

    // Wrong cash amount is refused.
    await tester.enterText(find.byKey(const Key('deliver-otp')), '1234');
    await tester.enterText(find.byKey(const Key('deliver-cash')), '400');
    await tester.tap(find.byKey(const Key('deliver-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Must be exactly Rs 450'), findsOneWidget);
    expect(submitted, isEmpty);

    await tester.enterText(find.byKey(const Key('deliver-cash')), '450');
    await tester.tap(find.byKey(const Key('deliver-submit')));
    await tester.pumpAndSettle();
    expect(submitted, hasLength(1));
    expect(submitted.single.otp, '1234');
    expect(submitted.single.cash, 45000);
    expect(submitted.single.photoPath, isNull);
    expect(result, isTrue);
    expect(find.byType(DeliverDialog), findsNothing);
  });

  testWidgets('photo required → submit blocked with a message; no OTP field when not required', (tester) async {
    final submitted = <DeliverInput>[];
    const paidStop = RiderStop(
      sequence: 1,
      orderId: 'o2',
      number: 'DB-2',
      status: 'OUT_FOR_DELIVERY',
      canAct: true,
      paymentStatus: 'PAID',
    );
    await tester.pumpWidget(
      _app(
        DeliverDialog(
          stop: paidStop,
          requires: const DeliverRequirements(photo: true),
          onSubmit: (i) async => submitted.add(i),
        ),
      ),
    );
    expect(find.byKey(const Key('deliver-otp')), findsNothing);
    expect(find.byKey(const Key('deliver-cash')), findsNothing);
    await tester.tap(find.byKey(const Key('deliver-submit')));
    await tester.pumpAndSettle();
    expect(find.text('A photo of the delivered dabba is required.'), findsOneWidget);
    expect(submitted, isEmpty);
  });

  test(
    'RiderRepository.deliver posts JSON with an Idempotency-Key, reused for the same action until answered',
    () async {
      final adapter = _FakeAdapter();
      final idem = IdempotencyRegistry(store: MemoryKeyValueStore());
      final api = ApiClient(
        baseUrl: 'https://example.test/api/v1',
        tokens: TokenStore(MemoryKeyValueStore()),
        idempotency: idem,
        adapter: adapter,
      );
      final repo = RiderRepository(api);
      final res = await repo.deliver('o1', const DeliverInput(otp: '1234', cash: 45000));
      expect(res['status'], 'DELIVERED');
      final req = adapter.requests.single;
      expect(req.method, 'POST');
      expect(req.uri.toString(), 'https://example.test/api/v1/rider/stops/o1/deliver');
      final key = req.headers['Idempotency-Key'] as String;
      expect(RegExp(r'^[A-Za-z0-9_\-:.]{8,80}$').hasMatch(key), isTrue);
      expect(jsonDecode(adapter.bodies.single), {'otp': '1234', 'cash': 45000});
      // Definitive answer → key released; the next delivery is a new action with a new key.
      await repo.deliver('o1', const DeliverInput(otp: '1234', cash: 45000));
      expect(adapter.requests.last.headers['Idempotency-Key'], isNot(key));
    },
  );

  test('DispatchRepository.resolveFailed sends action + reason with an Idempotency-Key', () async {
    final adapter = _FakeAdapter();
    final api = ApiClient(
      baseUrl: 'https://example.test/api/v1',
      tokens: TokenStore(MemoryKeyValueStore()),
      idempotency: IdempotencyRegistry(),
      adapter: adapter,
    );
    await DispatchRepository(api).resolveFailed('o5', 'CANCEL', 'Customer moved away');
    final req = adapter.requests.single;
    expect(req.uri.path, '/api/v1/dispatch/failed/o5/resolve');
    expect(req.headers['Idempotency-Key'], isNotNull);
    expect(jsonDecode(adapter.bodies.single), {'action': 'CANCEL', 'reason': 'Customer moved away'});
  });
}
