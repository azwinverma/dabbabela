import 'package:dabba_bela/core/api/api_exception.dart';
import 'package:dabba_bela/core/api/idempotency.dart';
import 'package:dabba_bela/core/config.dart';
import 'package:dabba_bela/core/format/dates.dart';
import 'package:dabba_bela/core/format/money.dart';
import 'package:dabba_bela/core/storage/secure_store.dart';
import 'package:flutter_test/flutter_test.dart';

import 'helpers.dart';

void main() {
  group('envelope', () {
    test('unwraps data + meta and reads the replay header', () async {
      final api = TestApi((r) => FakeReply.data([{'id': 'o1'}], meta: {'nextCursor': 'o1'}, headers: {'idempotent-replayed': 'true'}));
      final res = await api.client.get('/orders', query: {'scope': 'upcoming', 'cursor': null});
      expect(res.list, hasLength(1));
      expect(res.nextCursor, 'o1');
      expect(res.replayed, isTrue);
      expect(api.adapter.requests.single.query, {'scope': 'upcoming'}, reason: 'null query values are dropped');
    });

    test('sends bearer token and user agent; no token → no Authorization header', () async {
      final api = TestApi((r) => FakeReply.data({'ok': true}));
      await api.client.get('/settings');
      expect(api.adapter.requests.last.headers.containsKey('Authorization'), isFalse);
      await api.tokens.save('secret-token');
      await api.client.get('/me');
      expect(api.adapter.requests.last.headers['Authorization'], 'Bearer secret-token');
    });
  });

  group('error mapping', () {
    test('422 VALIDATION_FAILED → ApiException with fields', () async {
      final api = TestApi((r) => FakeReply.error(422, 'VALIDATION_FAILED', 'Check the phone', fields: {'phone': 'Use 98XXXXXXXX'}));
      final e = await _catch(() => api.client.post('/addresses', body: {'phone': '1'}));
      expect(e.statusCode, 422);
      expect(e.isValidation, isTrue);
      expect(e.message, 'Check the phone');
      expect(e.fields['phone'], 'Use 98XXXXXXXX');
      expect(e.isDefinitive, isTrue);
    });

    test('404 FEATURE_DISABLED is not "not found"', () async {
      final api = TestApi((r) => FakeReply.error(404, 'FEATURE_DISABLED', 'Top-ups are off'));
      final e = await _catch(() => api.client.post('/wallet/topups', body: {}));
      expect(e.isFeatureDisabled, isTrue);
      expect(e.isNotFound, isFalse);
    });

    test('non-JSON 502 → INTERNAL with a friendly message', () async {
      final api = TestApi((r) => const FakeReply(502, '<html>Bad gateway</html>'));
      final e = await _catch(() => api.client.get('/menu'));
      expect(e.code, 'INTERNAL');
      expect(e.isRetryable, isTrue);
      expect(e.message, isNot(contains('<html>')));
    });

    test('connection error → offline network failure', () async {
      final api = TestApi((r) => throw connectionError(r));
      final e = await _catch(() => api.client.get('/menu'));
      expect(e.kind, ApiFailureKind.network);
      expect(e.isOffline, isTrue);
      expect(e.isRetryable, isTrue);
    });
  });

  group('401 handling', () {
    test('UNAUTHENTICATED on a request with a token calls onUnauthenticated once', () async {
      final api = TestApi((r) => FakeReply.error(401, 'UNAUTHENTICATED', 'Sign in first'));
      var calls = 0;
      api.client.onUnauthenticated = () => calls++;
      await api.tokens.save('expired');
      final e = await _catch(() => api.client.get('/me'));
      expect(e.isUnauthenticated, isTrue);
      expect(calls, 1);
    });

    test('INVALID_CREDENTIALS (401 on sign-in, no token) does not sign out', () async {
      final api = TestApi((r) => FakeReply.error(401, 'INVALID_CREDENTIALS', 'Wrong email or password'));
      var calls = 0;
      api.client.onUnauthenticated = () => calls++;
      final e = await _catch(() => api.client.post('/auth/sign-in', body: {'email': 'a@b.c', 'password': 'x'}));
      expect(e.code, 'INVALID_CREDENTIALS');
      expect(calls, 0);
    });
  });

  group('idempotency', () {
    test('retries a timed-out / offline money-moving POST with the SAME key, then releases it', () async {
      var n = 0;
      final api = TestApi((r) {
        n++;
        if (n == 1) throw connectionError(r);
        return FakeReply.data({'next': 'DONE', 'payment': {'id': 'p1'}}, status: 201);
      });
      final body = {'lines': [{'kind': 'box', 'id': 'b1', 'date': '2026-11-24', 'qty': 1}], 'addressId': 'a1', 'method': 'CASH'};
      await api.client.post('/orders', body: body, idempotent: true);
      final keys = api.adapter.requests.map((r) => r.headers['Idempotency-Key']).toList();
      expect(keys, hasLength(2));
      expect(keys[0], isNotNull);
      expect(RegExp(r'^[A-Za-z0-9_\-:.]{8,80}$').hasMatch(keys[0] as String), isTrue);
      expect(keys[1], keys[0], reason: 'retry must reuse the key');
      // Definitive answer → the next identical tap is a NEW action.
      await api.client.post('/orders', body: body, idempotent: true);
      expect(api.adapter.requests.last.headers['Idempotency-Key'], isNot(keys[0]));
    });

    test('409 IDEMPOTENCY_IN_PROGRESS is retried with the same key', () async {
      var n = 0;
      final api = TestApi((r) => ++n == 1 ? FakeReply.error(409, 'IDEMPOTENCY_IN_PROGRESS', 'Still working') : FakeReply.data({'settlement': 'CREDIT'}));
      await api.client.post('/orders/o1/cancel', body: {'reason': 'x'}, idempotent: true);
      expect(api.adapter.requests[0].headers['Idempotency-Key'], api.adapter.requests[1].headers['Idempotency-Key']);
    });

    test('key survives giving up (all retries offline) and is reused by the next attempt — even after restart', () async {
      final api = TestApi((r) => throw connectionError(r));
      final body = {'amount': 50000, 'method': 'ESEWA'};
      await _catch(() => api.client.post('/wallet/topups', body: body, idempotent: true));
      final first = api.adapter.requests.first.headers['Idempotency-Key'];
      expect(api.adapter.requests.every((r) => r.headers['Idempotency-Key'] == first), isTrue);
      // "App restart": a new registry over the same persisted store hands back the same pending key.
      final again = IdempotencyRegistry(store: api.kv);
      final fp = IdempotencyRegistry.fingerprint('POST', '/wallet/topups', body);
      expect(await again.keyFor(fp), first);
    });

    test('a definitive 422 releases the key; a changed body is a different action', () async {
      final api = TestApi((r) => FakeReply.error(422, 'ORDER_REJECTED', 'Cut-off passed'));
      final body = {'addressId': 'a1', 'method': 'CASH', 'lines': <Object>[]};
      await _catch(() => api.client.post('/orders', body: body, idempotent: true));
      expect(api.adapter.requests, hasLength(1), reason: 'business rejections are not retried');
      final fp = IdempotencyRegistry.fingerprint('POST', '/orders', body);
      expect(api.idempotency.pendingKey(fp), isNull);
      expect(
        IdempotencyRegistry.fingerprint('POST', '/orders', {'method': 'CASH', 'addressId': 'a1', 'lines': <Object>[]}),
        fp,
        reason: 'key order does not matter',
      );
      expect(IdempotencyRegistry.fingerprint('POST', '/orders', {...body, 'method': 'ESEWA'}), isNot(fp));
    });

    test('GETs never carry an Idempotency-Key', () async {
      final api = TestApi((r) => FakeReply.data({}));
      await api.client.get('/wallet');
      expect(api.adapter.requests.single.headers.containsKey('Idempotency-Key'), isFalse);
    });
  });

  group('token store', () {
    test('persists only through the secure key-value store and clears', () async {
      final kv = MemoryKeyValueStore();
      final t = TokenStore(kv);
      await t.save('abc');
      expect(kv.values.values, contains('abc'));
      expect(await TokenStore(kv).load(), 'abc');
      await t.clear();
      expect(kv.values, isEmpty);
    });
  });

  group('formatting', () {
    test('money from paisa', () {
      expect(Money.format(125000), 'Rs 1,250');
      expect(Money.format(22650), 'Rs 226.50');
      expect(Money.format(12345600), 'Rs 1,23,456');
      expect(Money.format(-5000), '−Rs 50');
      expect(Money.format(5000, locale: 'ne'), 'रु 50');
      expect(Money.parse('1,250'), 125000);
      expect(Money.parse('Rs 226.5'), 22650);
      expect(Money.parse('५०'), 5000);
      expect(Money.parse('abc'), isNull);
    });

    test('Kathmandu service dates (UTC+05:45)', () {
      final saved = KtmDates.now;
      KtmDates.now = () => DateTime.utc(2026, 11, 21, 18, 30); // 00:15 on the 22nd in Kathmandu
      expect(KtmDates.today(), '2026-11-22');
      expect(KtmDates.addDays('2026-11-30', 1), '2026-12-01');
      expect(KtmDates.isTomorrow('2026-11-23'), isTrue);
      KtmDates.now = saved;
    });

    test('release builds refuse a plain-http base URL', () {
      expect(AppConfig.resolveBaseUrl('https://x.test/api/v1/', release: true), 'https://x.test/api/v1');
      expect(() => AppConfig.resolveBaseUrl('http://10.0.2.2:3000/api/v1', release: true), throwsStateError);
      expect(AppConfig.resolveBaseUrl('http://10.0.2.2:3000/api/v1', release: false), 'http://10.0.2.2:3000/api/v1');
    });
  });
}

Future<ApiException> _catch(Future<Object?> Function() f) async {
  try {
    await f();
  } on ApiException catch (e) {
    return e;
  }
  fail('expected ApiException');
}
