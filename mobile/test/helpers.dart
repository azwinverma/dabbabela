import 'dart:convert';
import 'dart:typed_data';

import 'package:dabba_bela/core/api/api_client.dart';
import 'package:dabba_bela/core/api/idempotency.dart';
import 'package:dabba_bela/core/l10n.dart';
import 'package:dabba_bela/core/providers.dart';
import 'package:dabba_bela/core/storage/secure_store.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// A canned HTTP answer.
class FakeReply {
  const FakeReply(this.status, this.body, {this.headers = const {}});
  final int status;
  final Object? body;
  final Map<String, String> headers;

  static FakeReply data(Object? data, {Map<String, Object?>? meta, int status = 200, Map<String, String> headers = const {}}) =>
      FakeReply(status, {'data': data, if (meta != null) 'meta': meta}, headers: headers);

  static FakeReply error(int status, String code, String message, {Map<String, String>? fields}) =>
      FakeReply(status, {'error': {'code': code, 'message': message, if (fields != null) 'fields': fields}});
}

class RecordedRequest {
  RecordedRequest(this.method, this.path, this.headers, this.body, this.query);
  final String method;
  final String path;
  final Map<String, dynamic> headers;
  final String body;
  final Map<String, dynamic> query;

  Object? get json => body.isEmpty ? null : jsonDecode(body);
}

/// Mocked Dio adapter: `handler` returns a [FakeReply] or throws a [DioException] (to simulate network errors).
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.handler);

  final FakeReply Function(RecordedRequest req) handler;
  final List<RecordedRequest> requests = [];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    final body = requestStream == null ? '' : utf8.decode(await requestStream.expand((b) => b).toList());
    final req = RecordedRequest(options.method, options.path, Map.of(options.headers), body, Map.of(options.queryParameters));
    requests.add(req);
    final reply = handler(req);
    return ResponseBody.fromString(
      reply.body is String ? reply.body! as String : jsonEncode(reply.body),
      reply.status,
      headers: {
        Headers.contentTypeHeader: [reply.body is String ? 'text/html' : 'application/json'],
        for (final e in reply.headers.entries) e.key: [e.value],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

/// Route table helper: "GET /me" → reply builder.
FakeReply Function(RecordedRequest) routes(Map<String, FakeReply Function(RecordedRequest)> table) => (req) {
      final key = '${req.method} ${req.path}';
      final h = table[key];
      if (h == null) return FakeReply.error(404, 'NOT_FOUND', 'No fake for $key');
      return h(req);
    };

DioException connectionError(RecordedRequest r) =>
    DioException(requestOptions: RequestOptions(path: r.path), type: DioExceptionType.connectionError, message: 'offline');

class TestApi {
  TestApi(FakeReply Function(RecordedRequest) handler, {String? token})
      : kv = MemoryKeyValueStore(),
        adapter = FakeAdapter(handler) {
    tokens = TokenStore(kv);
    idempotency = IdempotencyRegistry(store: kv);
    client = ApiClient(
      baseUrl: 'https://test.local/api/v1',
      tokens: tokens,
      idempotency: idempotency,
      adapter: adapter,
      retryDelays: const [Duration.zero, Duration.zero],
    );
    if (token != null) kv.values['db.session.token'] = token;
  }

  final MemoryKeyValueStore kv;
  final FakeAdapter adapter;
  late final TokenStore tokens;
  late final IdempotencyRegistry idempotency;
  late final ApiClient client;

  List<Override> get overrides => [
        keyValueStoreProvider.overrideWithValue(kv),
        tokenStoreProvider.overrideWithValue(tokens),
        idempotencyProvider.overrideWithValue(idempotency),
        apiClientProvider.overrideWithValue(client),
      ];
}

/// Wrap a screen with localisation + ProviderScope.
Widget testApp(Widget child, {List<Override> overrides = const [], Locale locale = const Locale('en')}) => ProviderScope(
      overrides: overrides,
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: child,
      ),
    );

/// A minimal GET /me payload.
Map<String, Object?> mePayload({
  String role = 'CUSTOMER',
  bool rider = false,
  bool kitchen = false,
  bool dispatcher = false,
  bool setupRequired = false,
}) =>
    {
      'user': {'id': 'u1', 'name': 'Sita Sharma', 'email': 'sita@example.com', 'phone': '9800000000', 'locale': 'en', 'role': role, 'roleLabel': role, 'isStaff': role != 'CUSTOMER'},
      'permissions': [if (rider) 'rider.view', if (kitchen) 'kitchen.view', if (dispatcher) 'dispatch.view'],
      'kitchenScope': {'all': false, 'kitchenIds': ['k1'], 'kitchens': [{'id': 'k1', 'name': 'Baneshwor Kitchen', 'code': 'BAN'}]},
      'company': null,
      'membershipStatus': null,
      'twoFactor': {'enabled': role != 'CUSTOMER' && !setupRequired, 'required': role != 'CUSTOMER', 'setupRequired': setupRequired},
      'apps': {'customer': true, 'rider': rider, 'kitchen': kitchen, 'dispatcher': dispatcher},
      'flags': {'phoneOtp': false, 'wallet': true, 'walletTopup': false, 'deliveryOtp': true, 'deliveryPhoto': false, 'staff2fa': true},
    };
