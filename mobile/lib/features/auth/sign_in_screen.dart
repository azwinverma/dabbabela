import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/api_exception.dart';
import '../../core/l10n.dart';
import '../../core/providers.dart';
import '../../core/validators.dart';
import '../../core/theme/brand.dart';
import '../../core/widgets/common.dart';
import 'session.dart';

/// Email + password, then (accounts with an authenticator) the 2FA code step on the same screen.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  bool _busy = false;
  bool _obscure = true;
  bool _backup = false;
  String? _challenge;
  String? _error;
  Map<String, String> _fields = const {};

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
      _fields = const {};
    });
    final session = ref.read(sessionProvider.notifier);
    try {
      if (_challenge == null) {
        final r = await session.signIn(_email.text, _password.text);
        if (r.twoFactorRequired && mounted) {
          setState(() => _challenge = r.challengeToken);
        }
      } else {
        await session.verifyTwoFactor(_challenge!, _code.text, backup: _backup);
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        if (e.isInvalidChallenge) {
          _challenge = null;
          _code.clear();
          _error = context.l10n.challengeExpired;
        } else {
          _error = e.isOffline ? context.l10n.offlineBody : e.message;
          _fields = e.fields;
        }
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final v = Validators(l);
    final twoFactor = _challenge != null;
    final otpEnabled = ref.watch(settingsProvider).valueOrNull?.flag('phoneOtp') ?? false;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Form(
                key: _form,
                child: AutofillGroup(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Center(child: Image.asset('assets/brand/logo-mark.png', width: 88, height: 88, semanticLabel: l.appName)),
                      const SizedBox(height: 12),
                      Text(l.appName, textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineMedium),
                      Text(l.tagline, textAlign: TextAlign.center),
                      const SizedBox(height: 28),
                      Text(twoFactor ? l.twoFactorTitle : l.signInTitle, style: Theme.of(context).textTheme.titleLarge),
                      const SizedBox(height: 12),
                      if (_error != null) ...[
                        Semantics(liveRegion: true, child: Notice(_error!, tone: Tone.bad)),
                        const SizedBox(height: 12),
                      ],
                      if (!twoFactor) ...[
                        TextFormField(
                          key: const Key('email'),
                          controller: _email,
                          keyboardType: TextInputType.emailAddress,
                          autofillHints: const [AutofillHints.email, AutofillHints.username],
                          textInputAction: TextInputAction.next,
                          decoration: InputDecoration(labelText: l.email, errorText: _fields['email']),
                          validator: v.email,
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          key: const Key('password'),
                          controller: _password,
                          obscureText: _obscure,
                          autofillHints: const [AutofillHints.password],
                          onFieldSubmitted: (_) => _submit(),
                          decoration: InputDecoration(
                            labelText: l.password,
                            errorText: _fields['password'],
                            suffixIcon: IconButton(
                              tooltip: l.showPassword,
                              icon: Icon(_obscure ? Icons.visibility : Icons.visibility_off),
                              onPressed: () => setState(() => _obscure = !_obscure),
                            ),
                          ),
                          validator: v.required,
                        ),
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton(onPressed: () => context.push('/auth/forgot'), child: Text(l.forgotPassword)),
                        ),
                      ] else ...[
                        Text(_backup ? l.backupCode : l.twoFactorBody),
                        const SizedBox(height: 12),
                        TextFormField(
                          key: const Key('code'),
                          controller: _code,
                          autofocus: true,
                          keyboardType: _backup ? TextInputType.text : TextInputType.number,
                          autofillHints: const [AutofillHints.oneTimeCode],
                          inputFormatters: _backup ? null : [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                          onFieldSubmitted: (_) => _submit(),
                          decoration: InputDecoration(labelText: _backup ? l.backupCode : l.code),
                          validator: v.required,
                        ),
                        TextButton(
                          onPressed: () => setState(() {
                            _backup = !_backup;
                            _code.clear();
                          }),
                          child: Text(_backup ? l.useAuthenticator : l.useBackupCode),
                        ),
                      ],
                      const SizedBox(height: 8),
                      FilledButton(
                        key: const Key('submit'),
                        onPressed: _busy ? null : _submit,
                        child: _busy
                            ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                            : Text(twoFactor ? l.verify : l.signIn),
                      ),
                      if (twoFactor)
                        TextButton(
                          onPressed: () => setState(() {
                            _challenge = null;
                            _code.clear();
                          }),
                          child: Text(l.back),
                        )
                      else ...[
                        const SizedBox(height: 12),
                        if (otpEnabled)
                          OutlinedButton.icon(
                            onPressed: () => context.push('/auth/otp'),
                            icon: const Icon(Icons.sms_outlined),
                            label: Text(l.phoneSignIn),
                          ),
                        TextButton(onPressed: () => context.push('/auth/sign-up'), child: Text(l.noAccount)),
                        TextButton(onPressed: () => context.push('/language'), child: Text('${l.language}: ${context.lang == 'ne' ? l.languageNepali : l.languageEnglish}')),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
