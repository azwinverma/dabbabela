import 'dart:async';

import 'package:dio/dio.dart';

import '../storage/secure_store.dart';
import 'api_exception.dart';
import 'idempotency.dart';

/// A successful /api/v1 response: the unwrapped `data`, optional `meta`, and whether it was an idempotent replay.
class ApiResponse {
  const ApiResponse(this.data, {this.meta = const {}, this.replayed = false, this.statusCode = 200});

  final Object? data;
  final Map<String, Object?> meta;
  final bool replayed;
  final int statusCode;

  Map<String, Object?> get map => data is Map ? (data! as Map).cast<String, Object?>() : const {};
  List<Object?> get list => data is List ? (data! as List).cast<Object?>() : const [];
  String? get nextCursor => meta['nextCursor'] is String ? meta['nextCursor'] as String : null;
}

/// Thin typed wrapper over Dio for the Dabba Bela API.
///
/// * `Authorization: Bearer <token>` from [TokenStore] (never logged).
/// * Success envelope `{data, meta?}` unwrapped into [ApiResponse]; failure envelope mapped to [ApiException].
/// * `401 UNAUTHENTICATED` on an authenticated request → [onUnauthenticated] (the session drops the token and shows
///   sign-in).
/// * Money-moving POSTs pass `idempotent: true`: an `Idempotency-Key` is attached from [IdempotencyRegistry] and the
///   request is retried (same key) on network errors, timeouts, `409 IDEMPOTENCY_IN_PROGRESS` and 5xx.
class ApiClient {
  ApiClient({
    required String baseUrl,
    required this.tokens,
    required this.idempotency,
    String userAgent = 'DabbaBela',
    HttpClientAdapter? adapter,
    this.retryDelays = const [Duration(milliseconds: 800), Duration(seconds: 2)],
    Duration connectTimeout = const Duration(seconds: 15),
    Duration receiveTimeout = const Duration(seconds: 30),
  }) : dio = Dio(
          BaseOptions(
            baseUrl: baseUrl,
            connectTimeout: connectTimeout,
            receiveTimeout: receiveTimeout,
            sendTimeout: const Duration(seconds: 60),
            responseType: ResponseType.json,
            headers: {'Accept': 'application/json', 'User-Agent': userAgent},
            // We map every status ourselves.
            validateStatus: (_) => true,
          ),
        ) {
    if (adapter != null) dio.httpClientAdapter = adapter;
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          final t = tokens.token;
          if (t != null && options.extra['auth'] != false) options.headers['Authorization'] = 'Bearer $t';
          handler.next(options);
        },
      ),
    );
  }

  final Dio dio;
  final TokenStore tokens;
  final IdempotencyRegistry idempotency;
  final List<Duration> retryDelays;

  /// Called once per 401 UNAUTHENTICATED answer to a request that carried a token.
  void Function()? onUnauthenticated;

  /// Locale the user picked (`en` / `ne`), sent as `?locale=` on catalogue reads by the repositories.
  String locale = 'en';

  Future<ApiResponse> get(String path, {Map<String, Object?>? query}) => _send('GET', path, query: query);

  Future<ApiResponse> post(String path, {Object? body, Map<String, Object?>? query, bool idempotent = false}) =>
      _send('POST', path, body: body, query: query, idempotent: idempotent);

  Future<ApiResponse> put(String path, {Object? body}) => _send('PUT', path, body: body);

  Future<ApiResponse> patch(String path, {Object? body}) => _send('PATCH', path, body: body);

  Future<ApiResponse> delete(String path, {Object? body}) => _send('DELETE', path, body: body);

  /// Multipart POST. [buildForm] is called per attempt (a FormData can only be sent once); [fingerprintFields]
  /// identifies the action for the idempotency key (fields + a file identity such as path and length).
  Future<ApiResponse> postMultipart(
    String path, {
    required FutureOr<FormData> Function() buildForm,
    required Map<String, Object?> fingerprintFields,
    bool idempotent = false,
  }) =>
      _send('POST', path, formBuilder: buildForm, fingerprintBody: fingerprintFields, idempotent: idempotent);

  Future<ApiResponse> _send(
    String method,
    String path, {
    Object? body,
    Map<String, Object?>? query,
    bool idempotent = false,
    FutureOr<FormData> Function()? formBuilder,
    Map<String, Object?>? fingerprintBody,
  }) async {
    final cleanQuery = <String, Object?>{};
    query?.forEach((k, v) {
      if (v != null && '$v'.isNotEmpty) cleanQuery[k] = v;
    });
    String? fp;
    String? key;
    if (idempotent) {
      fp = IdempotencyRegistry.fingerprint(method, path, fingerprintBody ?? body);
      key = await idempotency.keyFor(fp);
    }
    var attempt = 0;
    while (true) {
      try {
        final res = await _once(method, path, body: body, query: cleanQuery, key: key, formBuilder: formBuilder);
        if (fp != null) await idempotency.release(fp);
        return res;
      } on ApiException catch (e) {
        final canRetry = idempotent && e.isRetryable && !e.isRateLimited && attempt < retryDelays.length;
        if (canRetry) {
          await Future<void>.delayed(retryDelays[attempt]);
          attempt++;
          continue;
        }
        if (fp != null && e.isDefinitive) await idempotency.release(fp);
        rethrow;
      }
    }
  }

  Future<ApiResponse> _once(
    String method,
    String path, {
    Object? body,
    required Map<String, Object?> query,
    String? key,
    FutureOr<FormData> Function()? formBuilder,
  }) async {
    final hadToken = tokens.token != null;
    Response<Object?> res;
    try {
      final data = formBuilder != null ? await formBuilder() : body;
      res = await dio.request<Object?>(
        path,
        data: data,
        queryParameters: query.isEmpty ? null : query,
        options: Options(
          method: method,
          headers: {
            if (key != null) 'Idempotency-Key': key,
            if (formBuilder == null && body != null) 'Content-Type': 'application/json',
          },
        ),
      );
    } on DioException catch (e) {
      throw ApiException.fromDio(e);
    }
    final status = res.statusCode ?? 0;
    final payload = res.data;
    if (status >= 200 && status < 300) {
      if (payload is Map && payload.containsKey('data')) {
        final meta = payload['meta'];
        return ApiResponse(
          payload['data'],
          meta: meta is Map ? meta.cast<String, Object?>() : const {},
          replayed: res.headers.value('idempotent-replayed') == 'true',
          statusCode: status,
        );
      }
      // e.g. GET /openapi.json (not enveloped)
      return ApiResponse(payload, statusCode: status);
    }
    final error = ApiException.fromResponse(status, payload);
    if (error.isUnauthenticated && hadToken) onUnauthenticated?.call();
    throw error;
  }
}
