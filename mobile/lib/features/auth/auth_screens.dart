import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/l10n.dart';
import '../../core/validators.dart';
import '../../core/theme/brand.dart';
import '../../core/widgets/common.dart';
import 'session.dart';

/// Shared narrow form layout for the auth screens.
class AuthFormScaffold extends StatelessWidget {
  const AuthFormScaffold({super.key, required this.title, required this.children, this.formKey});

  final String title;
  final List<Widget> children;
  final GlobalKey<FormState>? formKey;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(title)),
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: Form(
                  key: formKey,
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
                ),
              ),
            ),
          ),
        ),
      );
}

const _gap = SizedBox(height: 12);

class SignUpScreen extends ConsumerStatefulWidget {
  const SignUpScreen({super.key});

  @override
  ConsumerState<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends ConsumerState<SignUpScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  final _company = TextEditingController();
  final _ref = TextEditingController();
  Map<String, String> _fields = const {};
  String? _error;

  @override
  void dispose() {
    for (final c in [_name, _email, _phone, _password, _company, _ref]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _error = null;
      _fields = const {};
    });
    try {
      final r = await ref.read(authRepositoryProvider).signUp(
            name: _name.text,
            email: _email.text,
            phone: _phone.text,
            password: _password.text,
            companyCode: _company.text,
            ref: _ref.text,
          );
      if (r.token != null) await ref.read(sessionProvider.notifier).acceptToken(r.token!);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _fields = e.fields;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final v = Validators(l);
    return AuthFormScaffold(
      title: l.signUp,
      formKey: _form,
      children: [
        Text(l.signUpTitle, style: Theme.of(context).textTheme.titleLarge),
        _gap,
        if (_error != null) ...[Notice(_error!, tone: Tone.bad), _gap],
        TextFormField(controller: _name, autofillHints: const [AutofillHints.name], decoration: InputDecoration(labelText: l.name, errorText: _fields['name']), validator: v.required),
        _gap,
        TextFormField(controller: _email, keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.email], decoration: InputDecoration(labelText: l.email, errorText: _fields['email']), validator: v.email),
        _gap,
        TextFormField(controller: _phone, keyboardType: TextInputType.phone, autofillHints: const [AutofillHints.telephoneNumber], decoration: InputDecoration(labelText: l.phone, hintText: l.phoneHint, errorText: _fields['phone']), validator: v.phone),
        _gap,
        TextFormField(controller: _password, obscureText: true, autofillHints: const [AutofillHints.newPassword], decoration: InputDecoration(labelText: l.password, errorText: _fields['password']), validator: v.password),
        _gap,
        TextFormField(controller: _company, decoration: InputDecoration(labelText: '${l.companyCode} (${l.optional})', errorText: _fields['companyCode'])),
        _gap,
        TextFormField(controller: _ref, decoration: InputDecoration(labelText: '${l.referralCode} (${l.optional})', errorText: _fields['ref'])),
        const SizedBox(height: 20),
        BusyButton(label: l.signUp, onPressed: _submit),
        TextButton(onPressed: () => context.go('/auth/sign-in'), child: Text(l.haveAccount)),
      ],
    );
  }
}

class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  String? _sent;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return AuthFormScaffold(
      title: l.forgotTitle,
      formKey: _form,
      children: [
        Text(l.forgotBody),
        _gap,
        if (_sent != null) ...[Notice(_sent!, tone: Tone.good), _gap],
        TextFormField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: InputDecoration(labelText: l.email), validator: Validators(l).email),
        const SizedBox(height: 20),
        BusyButton(
          label: l.sendLink,
          onPressed: () async {
            if (!_form.currentState!.validate()) return;
            final msg = await ref.read(authRepositoryProvider).forgotPassword(_email.text);
            if (mounted) setState(() => _sent = msg.isEmpty ? l.done : msg);
          },
        ),
        TextButton(onPressed: () => context.push('/auth/reset'), child: Text(l.haveResetCode)),
      ],
    );
  }
}

class ResetPasswordScreen extends ConsumerStatefulWidget {
  const ResetPasswordScreen({super.key, this.token});
  final String? token;

  @override
  ConsumerState<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends ConsumerState<ResetPasswordScreen> {
  final _form = GlobalKey<FormState>();
  late final _token = TextEditingController(text: widget.token);
  final _password = TextEditingController();

  @override
  void dispose() {
    _token.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final v = Validators(l);
    return AuthFormScaffold(
      title: l.setPassword,
      formKey: _form,
      children: [
        TextFormField(controller: _token, decoration: InputDecoration(labelText: l.resetCode), validator: v.required),
        _gap,
        TextFormField(controller: _password, obscureText: true, autofillHints: const [AutofillHints.newPassword], decoration: InputDecoration(labelText: l.newPassword), validator: v.password),
        const SizedBox(height: 20),
        BusyButton(
          label: l.setPassword,
          onPressed: () async {
            if (!_form.currentState!.validate()) return;
            await ref.read(authRepositoryProvider).resetPassword(_token.text, _password.text);
            if (!context.mounted) return;
            showSnack(context, l.passwordReset);
            context.go('/auth/sign-in');
          },
        ),
      ],
    );
  }
}

/// SMS sign-in (only offered when settings.flags.phoneOtp is on).
class PhoneOtpScreen extends ConsumerStatefulWidget {
  const PhoneOtpScreen({super.key});

  @override
  ConsumerState<PhoneOtpScreen> createState() => _PhoneOtpScreenState();
}

class _PhoneOtpScreenState extends ConsumerState<PhoneOtpScreen> {
  final _form = GlobalKey<FormState>();
  final _phone = TextEditingController();
  final _code = TextEditingController();
  bool _sent = false;
  String? _challenge;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (!_form.currentState!.validate()) return;
    await ref.read(authRepositoryProvider).sendOtp(_phone.text);
    if (mounted) setState(() => _sent = true);
  }

  Future<void> _verify() async {
    if (!_form.currentState!.validate()) return;
    final session = ref.read(sessionProvider.notifier);
    if (_challenge != null) {
      await session.verifyTwoFactor(_challenge!, _code.text);
      return;
    }
    final r = await ref.read(authRepositoryProvider).verifyOtp(_phone.text, _code.text);
    if (r.twoFactorRequired) {
      setState(() {
        _challenge = r.challengeToken;
        _code.clear();
      });
    } else if (r.token != null) {
      await session.acceptToken(r.token!);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final v = Validators(l);
    return AuthFormScaffold(
      title: l.phoneSignIn,
      formKey: _form,
      children: [
        TextFormField(
          controller: _phone,
          enabled: !_sent,
          keyboardType: TextInputType.phone,
          decoration: InputDecoration(labelText: l.phone, hintText: l.phoneHint),
          validator: v.phone,
        ),
        _gap,
        if (_sent) ...[
          Text(_challenge != null ? l.twoFactorBody : l.codeSent(_phone.text)),
          _gap,
          TextFormField(
            controller: _code,
            autofocus: true,
            keyboardType: TextInputType.number,
            autofillHints: const [AutofillHints.oneTimeCode],
            inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(8)],
            decoration: InputDecoration(labelText: l.code),
            validator: v.required,
          ),
          const SizedBox(height: 20),
          BusyButton(label: l.verify, onPressed: _verify),
          if (_challenge == null) TextButton(onPressed: () => setState(() => _sent = false), child: Text(l.resendCode)),
        ] else
          BusyButton(label: l.sendCode, onPressed: _send),
      ],
    );
  }
}
