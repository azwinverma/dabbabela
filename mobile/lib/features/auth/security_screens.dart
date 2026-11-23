import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/format/dates.dart';
import '../../core/l10n.dart';
import '../../core/providers.dart';
import '../../core/validators.dart';
import '../../core/theme/brand.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/states.dart';
import '../../models/auth.dart';
import 'auth_screens.dart';
import 'session.dart';

/// Staff authenticator enrolment: password → QR (totpURI) + backup codes → first code → NEW token replaces the old.
class TotpEnrolScreen extends ConsumerStatefulWidget {
  const TotpEnrolScreen({super.key});

  @override
  ConsumerState<TotpEnrolScreen> createState() => _TotpEnrolScreenState();
}

class _TotpEnrolScreenState extends ConsumerState<TotpEnrolScreen> {
  final _form = GlobalKey<FormState>();
  final _password = TextEditingController();
  final _code = TextEditingController();
  TotpEnrolment? _enrolment;

  @override
  void dispose() {
    _password.dispose();
    _code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final v = Validators(l);
    final me = ref.watch(meProvider);
    if (me?.twoFactorEnabled ?? false) {
      return AuthFormScaffold(title: l.enrolTitle, children: [Notice(l.twoFactorOn, tone: Tone.good)]);
    }
    final e = _enrolment;
    return AuthFormScaffold(
      title: l.enrolTitle,
      formKey: _form,
      children: e == null
          ? [
              Text(l.enrolIntro),
              const SizedBox(height: 12),
              TextFormField(controller: _password, obscureText: true, decoration: InputDecoration(labelText: l.password), validator: v.required),
              const SizedBox(height: 20),
              BusyButton(
                label: l.continueLabel,
                onPressed: () async {
                  if (!_form.currentState!.validate()) return;
                  final r = await ref.read(authRepositoryProvider).enableTwoFactor(_password.text);
                  _password.clear();
                  if (mounted) setState(() => _enrolment = r);
                },
              ),
            ]
          : [
              Text(l.enrolScan),
              const SizedBox(height: 12),
              Center(
                child: Container(
                  color: Colors.white,
                  padding: const EdgeInsets.all(12),
                  child: QrImageView(data: e.totpUri, size: 220, semanticsLabel: l.enrolScan),
                ),
              ),
              if (e.secret != null) ...[
                const SizedBox(height: 12),
                Text(l.enrolSecret, style: Theme.of(context).textTheme.labelLarge),
                SelectableText(e.secret!, style: const TextStyle(fontFamily: 'monospace', fontSize: 16)),
              ],
              const SizedBox(height: 16),
              SectionCard(
                title: l.backupCodesTitle,
                trailing: IconButton(
                  tooltip: l.copy,
                  icon: const Icon(Icons.copy),
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: e.backupCodes.join('\n')));
                    if (context.mounted) showSnack(context, l.copied);
                  },
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(l.backupCodesBody),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 12,
                      runSpacing: 6,
                      children: [for (final c in e.backupCodes) SelectableText(c, style: const TextStyle(fontFamily: 'monospace'))],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Text(l.enrolConfirm),
              const SizedBox(height: 8),
              TextFormField(
                controller: _code,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                decoration: InputDecoration(labelText: l.code),
                validator: v.required,
              ),
              const SizedBox(height: 20),
              BusyButton(
                label: l.verify,
                onPressed: () async {
                  if (!_form.currentState!.validate()) return;
                  final token = await ref.read(authRepositoryProvider).confirmTwoFactor(_code.text);
                  final session = ref.read(sessionProvider.notifier);
                  if (token != null) {
                    await session.acceptToken(token);
                  } else {
                    await session.refreshMe();
                  }
                  if (!context.mounted) return;
                  showSnack(context, l.enrolDone);
                  context.go('/switch');
                },
              ),
            ],
    );
  }
}

final sessionsProvider = FutureProvider.autoDispose<List<SessionInfo>>((ref) => ref.watch(authRepositoryProvider).sessions());

class SessionsScreen extends ConsumerWidget {
  const SessionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final me = ref.watch(meProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.sessionsTitle)),
      body: ProviderBody<List<SessionInfo>>(
        provider: sessionsProvider,
        builder: (context, sessions) => ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            if (me != null && (me.isStaff || me.twoFactorEnabled))
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: me.twoFactorEnabled
                    ? Notice(l.twoFactorOn, tone: Tone.good, icon: Icons.verified_user_outlined)
                    : Notice(l.twoFactorSetupBanner, tone: Tone.warn, action: TextButton(onPressed: () => context.push('/security/2fa'), child: Text(l.setUpNow))),
              ),
            for (final s in sessions)
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  leading: Icon(s.current ? Icons.smartphone : Icons.devices_other),
                  title: Text(s.current ? l.thisDevice : (s.userAgent ?? s.ipAddress ?? s.id), maxLines: 2, overflow: TextOverflow.ellipsis),
                  subtitle: Text(l.lastActive(KtmDates.timestamp(s.lastActiveAt ?? s.createdAt, locale: context.lang))),
                  trailing: s.current
                      ? null
                      : TextButton(
                          onPressed: () async {
                            try {
                              await ref.read(authRepositoryProvider).revokeSession(s.id);
                              ref.invalidate(sessionsProvider);
                            } catch (e) {
                              if (context.mounted) showError(context, e);
                            }
                          },
                          child: Text(l.revoke),
                        ),
                ),
              ),
            const SizedBox(height: 12),
            if (sessions.length > 1)
              BusyButton(
                label: l.signOutOthers,
                outlined: true,
                onPressed: () async {
                  await ref.read(authRepositoryProvider).revokeOtherSessions();
                  ref.invalidate(sessionsProvider);
                },
              ),
          ],
        ),
      ),
    );
  }
}

class LanguageScreen extends ConsumerWidget {
  const LanguageScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final current = ref.watch(localeProvider).languageCode;
    Future<void> pick(String code) async {
      await ref.read(localeProvider.notifier).set(code);
      if (ref.read(sessionProvider).signedIn) {
        try {
          await ref.read(apiClientProvider).patch('/profile', body: {'locale': code});
        } catch (_) {
          // The local choice still applies; the account locale syncs next time.
        }
      }
    }

    return Scaffold(
      appBar: AppBar(title: Text(l.language)),
      body: ListView(
        children: [
          for (final (code, label) in [('en', l.languageEnglish), ('ne', l.languageNepali)])
            ListTile(
              title: Text(label),
              trailing: current == code ? const Icon(Icons.check_circle) : const Icon(Icons.circle_outlined),
              selected: current == code,
              onTap: () => pick(code),
            ),
        ],
      ),
    );
  }
}
