import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/catalog.dart';
import 'api/api_client.dart';
import 'api/idempotency.dart';
import 'config.dart';
import 'push/push_service.dart';
import 'storage/secure_store.dart';

/// Root providers. Tests override [keyValueStoreProvider] (memory) and [apiClientProvider] (mock adapter).
final keyValueStoreProvider = Provider<KeyValueStore>((ref) => SecureKeyValueStore());

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore(ref.watch(keyValueStoreProvider)));

final idempotencyProvider = Provider<IdempotencyRegistry>(
  (ref) => IdempotencyRegistry(store: ref.watch(keyValueStoreProvider)),
);

final apiClientProvider = Provider<ApiClient>(
  (ref) => ApiClient(
    baseUrl: AppConfig.baseUrl,
    tokens: ref.watch(tokenStoreProvider),
    idempotency: ref.watch(idempotencyProvider),
    userAgent: AppConfig.userAgent,
  ),
);

final pushServiceProvider = Provider<PushService>((ref) => const NoopPushService());

/// The app's language. Starts from the device (en/ne), then follows the account's locale; changing it here also
/// PATCHes the profile (see LocaleController).
class LocaleController extends Notifier<Locale> {
  static const _key = 'db.locale';

  @override
  Locale build() {
    final device = WidgetsBinding.instance.platformDispatcher.locale.languageCode;
    _restore();
    return Locale(device == 'ne' ? 'ne' : 'en');
  }

  Future<void> _restore() async {
    final saved = await ref.read(keyValueStoreProvider).read(_key);
    if (saved == 'en' || saved == 'ne') _apply(saved!);
  }

  void _apply(String code) {
    state = Locale(code);
    ref.read(apiClientProvider).locale = code;
  }

  Future<void> set(String code, {bool persist = true}) async {
    if (code != 'en' && code != 'ne') return;
    _apply(code);
    if (persist) await ref.read(keyValueStoreProvider).write(_key, code);
  }
}

final localeProvider = NotifierProvider<LocaleController, Locale>(LocaleController.new);

/// GET /settings (public bootstrap: payment methods, cut-off, flags).
final settingsProvider = FutureProvider<AppSettings>((ref) async {
  final res = await ref.watch(apiClientProvider).get('/settings');
  return AppSettings.fromJson(res.map);
});
