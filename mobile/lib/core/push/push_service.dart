/// Push notifications abstraction.
///
/// TODO(push): no Firebase project exists yet. To turn push on:
///   1. Create a Firebase project; add the Android app `com.dabbabela.app` and the iOS app `com.dabbabela.app`.
///   2. Download `google-services.json` → android/app/ and `GoogleService-Info.plist` → ios/Runner/ (keep them out of
///      public repos if the project is public).
///   3. Add `firebase_core` + `firebase_messaging`, apply the `com.google.gms.google-services` Gradle plugin, enable
///      the Push Notifications + Background Modes (remote notifications) capabilities in Xcode and upload an APNs key
///      to Firebase.
///   4. Implement [PushService] with FirebaseMessaging (requestPermission, getToken, onTokenRefresh, onMessage) and
///      return it from `pushServiceProvider` in lib/core/providers.dart.
/// The rest is already wired: after sign-in the app calls POST /devices with the token (and again on refresh), and
/// sign-out sends `deviceToken` so the server unregisters it.
abstract class PushService {
  /// Ask for permission (iOS / Android 13+) and return this device's push token, or null when unavailable.
  Future<String?> init();

  /// Token rotations (re-register with POST /devices).
  Stream<String> get tokenRefreshes;

  /// The last token returned by [init] (sent with sign-out).
  String? get currentToken;
}

/// Default: no push. Every call is a harmless no-op.
class NoopPushService implements PushService {
  const NoopPushService();

  @override
  Future<String?> init() async => null;

  @override
  Stream<String> get tokenRefreshes => const Stream.empty();

  @override
  String? get currentToken => null;
}
