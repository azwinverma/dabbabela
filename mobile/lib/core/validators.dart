import 'l10n.dart';

/// Form validators mirroring the server rules (the server re-validates and its field messages are shown too).
class Validators {
  Validators(this.l);
  final AppLocalizations l;

  static final _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');
  static final _phone = RegExp(r'^(\+?977[- ]?)?9[678]\d{8}$');

  String? required(String? v) => (v ?? '').trim().isEmpty ? l.required : null;
  String? email(String? v) => _email.hasMatch((v ?? '').trim()) ? null : l.invalidEmail;
  String? phone(String? v) => isNepalMobile(v) ? null : l.invalidPhone;
  String? password(String? v) => (v ?? '').length < 8 ? l.passwordTooShort : null;

  static bool isNepalMobile(String? v) => _phone.hasMatch((v ?? '').replaceAll(RegExp(r'[\s-]'), ''));
}
