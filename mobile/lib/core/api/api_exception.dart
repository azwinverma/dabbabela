import 'package:dio/dio.dart';

/// Why a request failed, independent of the server's code.
enum ApiFailureKind {
  /// No connection / DNS / TLS / the request never reached the server.
  network,

  /// Connect, send or receive timeout — the request may or may not have run (retry with the same Idempotency-Key).
  timeout,

  /// The server answered with the error envelope `{error:{code,message,fields?}}` (or an unexpected body).
  server,

  /// The request was cancelled by the app.
  cancelled,
}

/// Typed error for every /api/v1 failure. `message` is safe to show (it is the server's user-facing message or a
/// friendly fallback); never contains tokens or request bodies.
class ApiException implements Exception {
  ApiException({
    required this.kind,
    required this.code,
    required this.message,
    this.statusCode,
    this.fields = const {},
  });

  final ApiFailureKind kind;

  /// Server error code (`UNAUTHENTICATED`, `VALIDATION_FAILED`, `ORDER_REJECTED`, …) or `NETWORK` / `TIMEOUT` /
  /// `CANCELLED` / `BAD_RESPONSE` for client-side failures.
  final String code;
  final String message;
  final int? statusCode;

  /// Per-field validation messages (VALIDATION_FAILED).
  final Map<String, String> fields;

  bool get isUnauthenticated => statusCode == 401 && code == 'UNAUTHENTICATED';
  bool get isTwoFactorSetupRequired => code == 'TWO_FACTOR_SETUP_REQUIRED';
  bool get isForbidden => statusCode == 403;
  bool get isNotFound => statusCode == 404 && code != 'FEATURE_DISABLED';
  bool get isFeatureDisabled => code == 'FEATURE_DISABLED';
  bool get isValidation => code == 'VALIDATION_FAILED';
  bool get isRateLimited => statusCode == 429;
  bool get isOffline => kind == ApiFailureKind.network;
  bool get isInvalidChallenge => code == 'INVALID_CHALLENGE';

  /// True when the outcome is unknown or temporary, so the same action may be retried with the SAME idempotency key:
  /// network errors, timeouts, `409 IDEMPOTENCY_IN_PROGRESS`, `429` and 5xx.
  bool get isRetryable {
    if (kind == ApiFailureKind.network || kind == ApiFailureKind.timeout) return true;
    if (code == 'IDEMPOTENCY_IN_PROGRESS') return true;
    final s = statusCode ?? 0;
    return s == 429 || s >= 500;
  }

  /// A definitive answer: the server ran (or refused) the request — release the idempotency key.
  bool get isDefinitive => !isRetryable && kind != ApiFailureKind.cancelled;

  static const _offlineMessage = "You're offline or the server can't be reached. Check your connection and try again.";
  static const _timeoutMessage = 'The server took too long to answer. Try again — repeating is safe.';

  /// Map any Dio failure to an [ApiException].
  factory ApiException.fromDio(DioException e) {
    if (e.error is ApiException) return e.error! as ApiException;
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return ApiException(kind: ApiFailureKind.timeout, code: 'TIMEOUT', message: _timeoutMessage);
      case DioExceptionType.cancel:
        return ApiException(kind: ApiFailureKind.cancelled, code: 'CANCELLED', message: 'Cancelled');
      case DioExceptionType.connectionError:
      case DioExceptionType.badCertificate:
        return ApiException(kind: ApiFailureKind.network, code: 'NETWORK', message: _offlineMessage);
      case DioExceptionType.badResponse:
        return ApiException.fromResponse(e.response?.statusCode, e.response?.data);
      case DioExceptionType.unknown:
        if (e.response != null) return ApiException.fromResponse(e.response?.statusCode, e.response?.data);
        return ApiException(kind: ApiFailureKind.network, code: 'NETWORK', message: _offlineMessage);
    }
  }

  /// Parse the error envelope `{ "error": { "code", "message", "fields"? } }`.
  factory ApiException.fromResponse(int? status, Object? body) {
    if (body is Map && body['error'] is Map) {
      final err = body['error'] as Map;
      final fields = <String, String>{};
      final f = err['fields'];
      if (f is Map) {
        f.forEach((k, v) {
          if (v != null) fields['$k'] = '$v';
        });
      }
      final code = err['code'] is String ? err['code'] as String : 'UNKNOWN';
      final message = err['message'] is String && (err['message'] as String).isNotEmpty
          ? err['message'] as String
          : _fallbackMessage(status);
      return ApiException(kind: ApiFailureKind.server, code: code, message: message, statusCode: status, fields: fields);
    }
    return ApiException(
      kind: ApiFailureKind.server,
      code: (status ?? 0) >= 500 ? 'INTERNAL' : 'BAD_RESPONSE',
      message: _fallbackMessage(status),
      statusCode: status,
    );
  }

  static String _fallbackMessage(int? status) {
    final s = status ?? 0;
    if (s == 401) return 'Please sign in again.';
    if (s == 403) return "You don't have permission to do that.";
    if (s == 404) return 'Not found.';
    if (s == 429) return 'Too many requests — wait a minute and try again.';
    if (s >= 500) return 'Something went wrong on our side — please try again.';
    return 'Something went wrong — please try again.';
  }

  @override
  String toString() => 'ApiException($code${statusCode != null ? ', $statusCode' : ''}): $message';
}
