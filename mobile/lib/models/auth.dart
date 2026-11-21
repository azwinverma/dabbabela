import '../core/json.dart';

/// `AuthUser` (sign-in / sign-up / 2FA results).
class AuthUser {
  const AuthUser({
    required this.id,
    required this.name,
    this.email,
    this.phone,
    this.role = 'CUSTOMER',
    this.twoFactorEnabled = false,
    this.locale = 'en',
  });

  final String id;
  final String name;
  final String? email;
  final String? phone;
  final String role;
  final bool twoFactorEnabled;
  final String locale;

  factory AuthUser.fromJson(Json j) => AuthUser(
        id: j.str('id'),
        name: j.str('name'),
        email: j.strOrNull('email'),
        phone: j.strOrNull('phone'),
        role: j.str('role', 'CUSTOMER'),
        twoFactorEnabled: j.boolean('twoFactorEnabled'),
        locale: j.str('locale', 'en'),
      );
}

/// `SignInResult`: a token, or a 2FA challenge (`twoFactorRequired` + `challengeToken`).
class SignInResult {
  const SignInResult({required this.twoFactorRequired, this.challengeToken, this.token, this.user, this.isNew = false});

  final bool twoFactorRequired;
  final String? challengeToken;
  final String? token;
  final AuthUser? user;

  /// Phone OTP only: the account was created by this sign-in.
  final bool isNew;

  factory SignInResult.fromJson(Json j) => SignInResult(
        twoFactorRequired: j.boolean('twoFactorRequired'),
        challengeToken: j.strOrNull('challengeToken'),
        token: j.strOrNull('token'),
        user: j.objOrNull('user') == null ? null : AuthUser.fromJson(j.obj('user')),
        isNew: j.boolean('isNew'),
      );
}

/// The app sections a user may open (`Me.apps`).
enum AppSection { customer, rider, kitchen, dispatcher }

class KitchenRef {
  const KitchenRef({required this.id, required this.name, this.code = ''});
  final String id;
  final String name;
  final String code;

  factory KitchenRef.fromJson(Json j) => KitchenRef(id: j.str('id'), name: j.str('name'), code: j.str('code'));
}

/// GET /me — role, permissions, kitchen scope, app sections, 2FA state and feature flags.
class Me {
  const Me({
    required this.id,
    required this.name,
    this.email,
    this.phone,
    this.phoneVerified = false,
    this.locale = 'en',
    this.role = 'CUSTOMER',
    this.roleLabel = '',
    this.isStaff = false,
    this.permissions = const [],
    this.kitchenScopeAll = false,
    this.kitchens = const [],
    this.companyName,
    this.membershipStatus,
    this.twoFactorEnabled = false,
    this.twoFactorRequired = false,
    this.twoFactorSetupRequired = false,
    this.apps = const {AppSection.customer},
    this.flags = const {},
  });

  final String id;
  final String name;
  final String? email;
  final String? phone;
  final bool phoneVerified;
  final String locale;
  final String role;
  final String roleLabel;
  final bool isStaff;
  final List<String> permissions;
  final bool kitchenScopeAll;
  final List<KitchenRef> kitchens;
  final String? companyName;
  final String? membershipStatus;
  final bool twoFactorEnabled;
  final bool twoFactorRequired;
  final bool twoFactorSetupRequired;
  final Set<AppSection> apps;
  final Map<String, bool> flags;

  bool flag(String name) => flags[name] ?? false;
  bool can(String permission) => permissions.contains(permission);

  /// Apps in display order.
  List<AppSection> get appList => AppSection.values.where(apps.contains).toList();

  factory Me.fromJson(Json j) {
    final user = j.obj('user');
    final appsJ = j.obj('apps');
    final apps = <AppSection>{
      for (final s in AppSection.values)
        if (appsJ.boolean(s.name, s == AppSection.customer)) s,
    };
    final flags = <String, bool>{};
    j.obj('flags').forEach((k, v) {
      if (v is bool) flags[k] = v;
    });
    final scope = j.obj('kitchenScope');
    final twoFactor = j.obj('twoFactor');
    return Me(
      id: user.str('id'),
      name: user.str('name'),
      email: user.strOrNull('email'),
      phone: user.strOrNull('phone'),
      phoneVerified: user.boolean('phoneVerified'),
      locale: user.str('locale', 'en'),
      role: user.str('role', 'CUSTOMER'),
      roleLabel: user.str('roleLabel'),
      isStaff: user.boolean('isStaff'),
      permissions: j.strs('permissions'),
      kitchenScopeAll: scope.boolean('all'),
      kitchens: scope.list('kitchens', KitchenRef.fromJson),
      companyName: j.objOrNull('company')?.strOrNull('name'),
      membershipStatus: j.strOrNull('membershipStatus'),
      twoFactorEnabled: twoFactor.boolean('enabled'),
      twoFactorRequired: twoFactor.boolean('required'),
      twoFactorSetupRequired: twoFactor.boolean('setupRequired'),
      apps: apps,
      flags: flags,
    );
  }
}

class SessionInfo {
  const SessionInfo({
    required this.id,
    this.current = false,
    this.ipAddress,
    this.userAgent,
    this.createdAt,
    this.lastActiveAt,
    this.expiresAt,
  });

  final String id;
  final bool current;
  final String? ipAddress;
  final String? userAgent;
  final DateTime? createdAt;
  final DateTime? lastActiveAt;
  final DateTime? expiresAt;

  factory SessionInfo.fromJson(Json j) => SessionInfo(
        id: j.str('id'),
        current: j.boolean('current'),
        ipAddress: j.strOrNull('ipAddress'),
        userAgent: j.strOrNull('userAgent'),
        createdAt: j.date('createdAt'),
        lastActiveAt: j.date('lastActiveAt'),
        expiresAt: j.date('expiresAt'),
      );
}

/// POST /auth/two-factor/enable.
class TotpEnrolment {
  const TotpEnrolment({required this.totpUri, required this.backupCodes});
  final String totpUri;
  final List<String> backupCodes;

  factory TotpEnrolment.fromJson(Json j) => TotpEnrolment(totpUri: j.str('totpURI'), backupCodes: j.strs('backupCodes'));

  /// The base32 secret inside the otpauth:// URI, for manual entry.
  String? get secret => Uri.tryParse(totpUri)?.queryParameters['secret'];
}
