import 'dart:convert';

import 'package:uuid/uuid.dart';

import '../storage/secure_store.dart';

/// Idempotency keys for money-moving POSTs (docs/api/README.md → Idempotency).
///
/// One key per *user action*: the key is derived from the action's fingerprint (method + path + body), kept until the
/// server gives a definitive answer, and reused for every retry of the same action — automatic retries, a second tap
/// after a timeout, or the app restarting (pending keys are persisted for 24 h). A changed body (e.g. a different
/// cart) is a different action and gets a new key, so the server never sees `IDEMPOTENCY_KEY_REUSED` from us.
class IdempotencyRegistry {
  IdempotencyRegistry({KeyValueStore? store, DateTime Function()? clock, String Function()? newKey})
      : _store = store,
        _clock = clock ?? DateTime.now,
        _newKey = newKey ?? (() => const Uuid().v4());

  static const _storageKey = 'db.idempotency.pending';
  static const _ttl = Duration(hours: 24);

  final KeyValueStore? _store;
  final DateTime Function() _clock;
  final String Function() _newKey;
  final Map<String, _Pending> _pending = {};
  bool _loaded = false;

  /// Stable fingerprint of an action.
  static String fingerprint(String method, String path, Object? body) {
    final canonical = '${method.toUpperCase()} $path ${_canonicalJson(body)}';
    return _fnv1a64(canonical);
  }

  /// Key for this action: the pending one if a previous attempt didn't get a definitive answer, else a new one.
  Future<String> keyFor(String fingerprint) async {
    await _load();
    final now = _clock();
    final existing = _pending[fingerprint];
    if (existing != null && now.difference(existing.at) < _ttl) return existing.key;
    final key = _newKey();
    _pending[fingerprint] = _Pending(key, now);
    await _persist();
    return key;
  }

  /// The server answered definitively (success, or a 4xx that isn't "in progress") — the next identical action is a
  /// NEW action with a new key.
  Future<void> release(String fingerprint) async {
    await _load();
    if (_pending.remove(fingerprint) != null) await _persist();
  }

  /// Pending key for a fingerprint (tests / diagnostics).
  String? pendingKey(String fingerprint) => _pending[fingerprint]?.key;

  Future<void> clear() async {
    _pending.clear();
    await _persist();
  }

  Future<void> _load() async {
    if (_loaded) return;
    _loaded = true;
    final raw = await _store?.read(_storageKey);
    if (raw == null) return;
    try {
      final map = jsonDecode(raw);
      if (map is Map) {
        final now = _clock();
        map.forEach((k, v) {
          if (v is Map && v['key'] is String && v['at'] is String) {
            final at = DateTime.tryParse(v['at'] as String);
            if (at != null && now.difference(at) < _ttl) _pending['$k'] = _Pending(v['key'] as String, at);
          }
        });
      }
    } catch (_) {
      // Corrupt entry: start fresh.
    }
  }

  Future<void> _persist() async {
    final store = _store;
    if (store == null) return;
    if (_pending.isEmpty) {
      await store.write(_storageKey, null);
      return;
    }
    await store.write(
      _storageKey,
      jsonEncode({for (final e in _pending.entries) e.key: {'key': e.value.key, 'at': e.value.at.toIso8601String()}}),
    );
  }

  static String _canonicalJson(Object? v) {
    if (v is Map) {
      final keys = v.keys.map((k) => '$k').toList()..sort();
      return '{${keys.map((k) => '${jsonEncode(k)}:${_canonicalJson(v[k])}').join(',')}}';
    }
    if (v is List) return '[${v.map(_canonicalJson).join(',')}]';
    return jsonEncode(v);
  }

  /// FNV-1a over UTF-8 bytes, two 32-bit lanes (stable across runs, unlike String.hashCode).
  static String _fnv1a64(String s) {
    // x * 16777619 written as shifts so it's exact on every platform (no > 2^53 products).
    int mul(int x) => (x + (x << 1) + (x << 4) + (x << 7) + (x << 8) + ((x << 24) & 0xffffffff)) & 0xffffffff;
    var h1 = 0x811c9dc5;
    var h2 = 0x5bd1e995;
    for (final b in utf8.encode(s)) {
      h1 = mul((h1 ^ b) & 0xffffffff);
      h2 = (mul((h2 ^ b) & 0xffffffff) + 0x9e3779b9) & 0xffffffff;
    }
    return '${h1.toRadixString(16).padLeft(8, '0')}${h2.toRadixString(16).padLeft(8, '0')}';
  }
}

class _Pending {
  _Pending(this.key, this.at);
  final String key;
  final DateTime at;
}
