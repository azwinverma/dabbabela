import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Tiny key/value abstraction over the platform keychain so tests can use memory.
abstract class KeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String? value);
}

/// Keychain (iOS) / Keystore-backed EncryptedSharedPreferences (Android).
class SecureKeyValueStore implements KeyValueStore {
  SecureKeyValueStore([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
            );

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) async {
    try {
      return await _storage.read(key: key);
    } catch (_) {
      // Keystore corruption after a backup restore: treat as signed out rather than crash.
      return null;
    }
  }

  @override
  Future<void> write(String key, String? value) async {
    if (value == null) {
      await _storage.delete(key: key);
    } else {
      await _storage.write(key: key, value: value);
    }
  }
}

class MemoryKeyValueStore implements KeyValueStore {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String? value) async {
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }
}

/// Holds the bearer token: in memory for the interceptor, persisted ONLY in secure storage. Never logged.
class TokenStore {
  TokenStore(this._kv);

  static const _key = 'db.session.token';
  final KeyValueStore _kv;
  String? _token;
  bool _loaded = false;

  String? get token => _token;

  Future<String?> load() async {
    if (!_loaded) {
      _token = await _kv.read(_key);
      _loaded = true;
    }
    return _token;
  }

  Future<void> save(String token) async {
    _token = token;
    _loaded = true;
    await _kv.write(_key, token);
  }

  Future<void> clear() async {
    _token = null;
    _loaded = true;
    await _kv.write(_key, null);
  }
}
