/// Tolerant JSON readers for API payloads. The API is additive-only ("clients must ignore unknown fields"), and many
/// fields are nullable, so models read with defaults instead of throwing on a missing key.
typedef Json = Map<String, Object?>;

Json asJson(Object? v) => v is Map ? v.cast<String, Object?>() : <String, Object?>{};

List<Json> asJsonList(Object? v) => v is List ? v.map(asJson).toList() : const <Json>[];

extension JsonRead on Json {
  String str(String k, [String fallback = '']) {
    final v = this[k];
    if (v is String) return v;
    if (v == null) return fallback;
    return '$v';
  }

  String? strOrNull(String k) {
    final v = this[k];
    if (v == null) return null;
    if (v is String) return v;
    return '$v';
  }

  int integer(String k, [int fallback = 0]) {
    final v = this[k];
    if (v is int) return v;
    if (v is num) return v.round();
    if (v is String) return int.tryParse(v) ?? fallback;
    return fallback;
  }

  int? intOrNull(String k) {
    final v = this[k];
    if (v is int) return v;
    if (v is num) return v.round();
    if (v is String) return int.tryParse(v);
    return null;
  }

  double? dblOrNull(String k) {
    final v = this[k];
    if (v is num) return v.toDouble();
    if (v is String) return double.tryParse(v);
    return null;
  }

  bool boolean(String k, [bool fallback = false]) {
    final v = this[k];
    if (v is bool) return v;
    return fallback;
  }

  DateTime? date(String k) {
    final v = this[k];
    if (v is String) return DateTime.tryParse(v);
    return null;
  }

  Json obj(String k) => asJson(this[k]);

  Json? objOrNull(String k) => this[k] is Map ? asJson(this[k]) : null;

  List<Json> objs(String k) => asJsonList(this[k]);

  List<String> strs(String k) {
    final v = this[k];
    if (v is List) return v.where((e) => e != null).map((e) => '$e').toList();
    return const [];
  }

  List<T> list<T>(String k, T Function(Json) f) => objs(k).map(f).toList();
}
