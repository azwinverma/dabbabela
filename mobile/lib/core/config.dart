import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';

/// Build-time configuration.
///
/// `flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1` points the app at another backend.
class AppConfig {
  AppConfig._();

  static const String defaultBaseUrl = 'https://dabbabela.vercel.app/api/v1';

  static const String _rawBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: defaultBaseUrl);

  /// Keep in sync with `version:` in pubspec.yaml (sent in the User-Agent the API asks for).
  static const String appVersion = String.fromEnvironment('APP_VERSION', defaultValue: '1.0.0');

  /// API base URL without a trailing slash. Release builds refuse plain http (TLS only); debug builds may use a local
  /// http backend.
  static String get baseUrl => resolveBaseUrl(_rawBaseUrl, release: kReleaseMode);

  @visibleForTesting
  static String resolveBaseUrl(String raw, {required bool release}) {
    var url = raw.trim();
    while (url.endsWith('/')) {
      url = url.substring(0, url.length - 1);
    }
    if (release && !url.startsWith('https://')) {
      throw StateError('API_BASE_URL must use https:// in release builds (got "$url").');
    }
    return url;
  }

  /// Site origin (for links into the website, e.g. password reset and notification links).
  static String get siteOrigin {
    final uri = Uri.parse(baseUrl);
    return uri.replace(path: '', query: null).toString().replaceAll(RegExp(r'/$'), '');
  }

  static String get platformName {
    if (kIsWeb) return 'web';
    if (Platform.isIOS) return 'ios';
    if (Platform.isAndroid) return 'android';
    return Platform.operatingSystem;
  }

  /// `DabbaBela/<appVersion> (<ios|android>)` as docs/api/README.md asks.
  static String get userAgent => 'DabbaBela/$appVersion ($platformName)';

  /// Device platform for POST /devices.
  static String get devicePlatform {
    if (kIsWeb) return 'WEB';
    return Platform.isIOS ? 'IOS' : 'ANDROID';
  }
}
