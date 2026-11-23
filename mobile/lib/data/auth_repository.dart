import '../core/api/api_client.dart';
import '../core/config.dart';
import '../models/auth.dart';

/// /auth/*, /me, /devices.
class AuthRepository {
  AuthRepository(this.api);
  final ApiClient api;

  Future<SignInResult> signIn(String email, String password) async {
    final r = await api.post('/auth/sign-in', body: {'email': email.trim(), 'password': password});
    return SignInResult.fromJson(r.map);
  }

  Future<SignInResult> verifyTwoFactor(String challengeToken, String code, {bool backup = false}) async {
    final r = await api.post('/auth/two-factor/verify', body: {'challengeToken': challengeToken, 'code': code.trim(), if (backup) 'backup': true});
    return SignInResult.fromJson(r.map);
  }

  Future<SignInResult> signUp({required String name, required String email, required String phone, required String password, String? companyCode, String? ref}) async {
    final r = await api.post('/auth/sign-up', body: {
      'name': name.trim(),
      'email': email.trim(),
      'phone': phone.trim(),
      'password': password,
      if (companyCode != null && companyCode.trim().isNotEmpty) 'companyCode': companyCode.trim(),
      if (ref != null && ref.trim().isNotEmpty) 'ref': ref.trim(),
    },);
    return SignInResult.fromJson(r.map);
  }

  Future<void> sendOtp(String phone) => api.post('/auth/otp/send', body: {'phone': phone.trim()});

  Future<SignInResult> verifyOtp(String phone, String code) async {
    final r = await api.post('/auth/otp/verify', body: {'phone': phone.trim(), 'code': code.trim()});
    return SignInResult.fromJson(r.map);
  }

  Future<String> forgotPassword(String email) async {
    final r = await api.post('/auth/password/forgot', body: {'email': email.trim()});
    return r.map['message'] is String ? r.map['message']! as String : '';
  }

  Future<void> resetPassword(String token, String password) => api.post('/auth/password/reset', body: {'token': token.trim(), 'password': password});

  Future<Me> me() async => Me.fromJson((await api.get('/me')).map);

  Future<void> signOut({String? deviceToken}) => api.post('/auth/sign-out', body: {if (deviceToken != null) 'deviceToken': deviceToken});

  Future<TotpEnrolment> enableTwoFactor(String password) async =>
      TotpEnrolment.fromJson((await api.post('/auth/two-factor/enable', body: {'password': password})).map);

  /// Returns the NEW session token (Better Auth rotates the session when 2FA turns on).
  Future<String?> confirmTwoFactor(String code) async {
    final r = await api.post('/auth/two-factor/confirm', body: {'code': code.trim()});
    final t = r.map['token'];
    return t is String && t.isNotEmpty ? t : null;
  }

  Future<List<SessionInfo>> sessions() async =>
      (await api.get('/auth/sessions')).list.whereType<Map<Object?, Object?>>().map((m) => SessionInfo.fromJson(m.cast())).toList();

  Future<void> revokeSession(String id) => api.delete('/auth/sessions/$id');

  Future<void> revokeOtherSessions() => api.delete('/auth/sessions');

  Future<void> registerDevice(String token) =>
      api.post('/devices', body: {'token': token, 'platform': AppConfig.devicePlatform, 'appVersion': AppConfig.appVersion});

  Future<void> unregisterDevice(String token) => api.delete('/devices', body: {'token': token});
}
