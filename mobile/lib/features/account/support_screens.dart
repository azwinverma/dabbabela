import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/format/dates.dart';
import '../../core/l10n.dart';
import '../../core/theme/brand.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/states.dart';
import '../../models/customer.dart';
import '../customer/customer_providers.dart';
import 'account_screens.dart';

final referralsProvider = FutureProvider.autoDispose<Referrals>((ref) => ref.watch(customerRepositoryProvider).referrals());
final ticketsProvider = FutureProvider.autoDispose<List<TicketSummary>>((ref) => ref.watch(customerRepositoryProvider).tickets());
final ticketProvider = FutureProvider.autoDispose.family<TicketDetail, String>((ref, id) => ref.watch(customerRepositoryProvider).ticket(id));
final privacyRequestsProvider = FutureProvider.autoDispose<List<PrivacyRequest>>((ref) => ref.watch(customerRepositoryProvider).privacyRequests());

class ReferralsScreen extends ConsumerWidget {
  const ReferralsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l.referrals)),
      body: ProviderBody<Referrals>(
        provider: referralsProvider,
        builder: (context, r) => ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            if (!r.enabled) Notice(l.referralsOff),
            if (r.code != null)
              SectionCard(
                title: l.yourCode,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SelectableText(r.code!, style: Theme.of(context).textTheme.headlineMedium?.copyWith(letterSpacing: 2)),
                    if (r.shareText != null) Text(r.shareText!),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: () => Share.share([r.shareText, r.shareUrl].whereType<String>().join('\n')),
                            icon: const Icon(Icons.share),
                            label: Text(l.share),
                          ),
                        ),
                        const SizedBox(width: 8),
                        OutlinedButton.icon(
                          onPressed: () async {
                            await Clipboard.setData(ClipboardData(text: r.shareUrl ?? r.code!));
                            if (context.mounted) showSnack(context, l.copied);
                          },
                          icon: const Icon(Icons.copy),
                          label: Text(l.copy),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 12),
            SectionCard(
              title: l.rewardsEarned,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  InfoRow(l.rewardsEarned, rs(context, r.rewarded), bold: true),
                  InfoRow(l.friendsJoined, '${r.friends.length}'),
                  for (final f in r.friends) InfoRow(f.name, l.statusLabel(f.status)),
                ],
              ),
            ),
            if (r.canClaim) ...[
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: () async {
                  final code = await promptText(context, title: l.haveFriendCode, label: l.referralCode, minLength: 3, maxLength: 40, maxLines: 1, confirmLabel: l.claim);
                  if (code == null) return;
                  try {
                    final msg = await ref.read(customerRepositoryProvider).claimReferral(code);
                    if (context.mounted && msg.isNotEmpty) showSnack(context, msg);
                  } catch (e) {
                    if (context.mounted) showError(context, e);
                  }
                  ref.invalidate(referralsProvider);
                },
                child: Text(l.haveFriendCode),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

String ticketCategoryLabel(AppLocalizations l, String c) => switch (c) {
      'ORDER' => l.tcORDER,
      'PAYMENT' => l.tcPAYMENT,
      'DELIVERY' => l.tcDELIVERY,
      'FOOD' => l.tcFOOD,
      'ACCOUNT' => l.tcACCOUNT,
      'CORPORATE' => l.tcCORPORATE,
      _ => l.tcGENERAL,
    };

class SupportScreen extends ConsumerWidget {
  const SupportScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final contact = supportContact(ref);
    return Scaffold(
      appBar: AppBar(title: Text(l.support)),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          await context.push('/c/support/new');
          ref.invalidate(ticketsProvider);
        },
        icon: const Icon(Icons.add_comment_outlined),
        label: Text(l.newTicket),
      ),
      body: ProviderBody<List<TicketSummary>>(
        provider: ticketsProvider,
        builder: (context, list) => ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(0, 8, 0, 96),
          children: [
            if (contact != null && contact.isNotEmpty) ListTile(leading: const Icon(Icons.phone_in_talk_outlined), title: SelectableText(contact)),
            if (list.isEmpty) EmptyView(message: l.noTickets, icon: Icons.support_agent),
            for (final t in list)
              ListTile(
                title: Text(t.subject),
                subtitle: Text('${t.number} · ${ticketCategoryLabel(l, t.category)} · ${KtmDates.timestamp(t.updatedAt, locale: context.lang)}'),
                trailing: StatusChip(t.status),
                onTap: () => context.push('/c/support/${t.id}'),
              ),
          ],
        ),
      ),
    );
  }
}

class NewTicketScreen extends ConsumerStatefulWidget {
  const NewTicketScreen({super.key, this.orderId});
  final String? orderId;

  @override
  ConsumerState<NewTicketScreen> createState() => _NewTicketScreenState();
}

class _NewTicketScreenState extends ConsumerState<NewTicketScreen> {
  final _form = GlobalKey<FormState>();
  final _subject = TextEditingController();
  final _body = TextEditingController();
  late String _category = widget.orderId != null ? 'ORDER' : 'GENERAL';

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l.newTicket)),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            DropdownButtonFormField<String>(
              value: _category,
              decoration: InputDecoration(labelText: l.category),
              items: [
                for (final c in const ['ORDER', 'PAYMENT', 'DELIVERY', 'FOOD', 'ACCOUNT', 'CORPORATE', 'GENERAL']) DropdownMenuItem(value: c, child: Text(ticketCategoryLabel(l, c))),
              ],
              onChanged: (c) => setState(() => _category = c ?? _category),
            ),
            const SizedBox(height: 12),
            TextFormField(controller: _subject, maxLength: 160, decoration: InputDecoration(labelText: l.subject), validator: (v) => (v ?? '').trim().length < 3 ? l.required : null),
            TextFormField(controller: _body, maxLength: 4000, maxLines: 6, decoration: InputDecoration(labelText: l.message), validator: (v) => (v ?? '').trim().length < 5 ? l.required : null),
            const SizedBox(height: 12),
            BusyButton(
              label: l.send,
              onPressed: () async {
                if (!_form.currentState!.validate()) return;
                final id = await ref.read(customerRepositoryProvider).openTicket(subject: _subject.text.trim(), body: _body.text.trim(), category: _category, orderId: widget.orderId);
                if (!context.mounted) return;
                if (id.isNotEmpty) {
                  context.pushReplacement('/c/support/$id');
                } else {
                  context.pop();
                }
              },
            ),
          ],
        ),
      ),
    );
  }
}

class TicketScreen extends ConsumerStatefulWidget {
  const TicketScreen({super.key, required this.id});
  final String id;

  @override
  ConsumerState<TicketScreen> createState() => _TicketScreenState();
}

class _TicketScreenState extends ConsumerState<TicketScreen> {
  final _reply = TextEditingController();

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text(l.support)),
      body: ProviderBody<TicketDetail>(
        provider: ticketProvider(widget.id),
        builder: (context, t) => Column(
          children: [
            Expanded(
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                children: [
                  Row(children: [Expanded(child: Text(t.subject, style: Theme.of(context).textTheme.titleLarge)), StatusChip(t.status)]),
                  Text(t.number),
                  const SizedBox(height: 12),
                  for (final m in t.messages)
                    Align(
                      alignment: m.fromMe ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 320),
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: m.fromMe ? BrandColors.haldiLight : scheme.surfaceContainerHigh,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(m.body, style: TextStyle(color: m.fromMe ? BrandColors.ink : null)),
                            const SizedBox(height: 4),
                            Text('${m.author} · ${KtmDates.timestamp(m.createdAt, locale: context.lang)}', style: TextStyle(fontSize: 11, color: m.fromMe ? BrandColors.inkSoft : null)),
                          ],
                        ),
                      ),
                    ),
                  if (!t.canReply) Notice(l.ticketClosed),
                ],
              ),
            ),
            if (t.canReply)
              SafeArea(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 8),
                  child: Row(
                    children: [
                      Expanded(child: TextField(controller: _reply, minLines: 1, maxLines: 4, decoration: InputDecoration(hintText: l.replyHint))),
                      const SizedBox(width: 8),
                      IconButton.filled(
                        tooltip: l.send,
                        onPressed: () async {
                          final text = _reply.text.trim();
                          if (text.isEmpty) return;
                          try {
                            await ref.read(customerRepositoryProvider).replyTicket(t.id, text);
                            _reply.clear();
                            ref.invalidate(ticketProvider(t.id));
                          } catch (e) {
                            if (context.mounted) showError(context, e);
                          }
                        },
                        icon: const Icon(Icons.send),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class PrivacyScreen extends ConsumerWidget {
  const PrivacyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l10n;
    final repo = ref.watch(customerRepositoryProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.privacy)),
      body: ProviderBody<List<PrivacyRequest>>(
        provider: privacyRequestsProvider,
        builder: (context, reqs) => ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            SectionCard(
              title: l.exportData,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(l.exportDataBody),
                  const SizedBox(height: 12),
                  BusyButton(
                    label: l.exportData,
                    icon: Icons.download,
                    outlined: true,
                    onPressed: () async {
                      final data = await repo.privacyExport();
                      final text = const JsonEncoder.withIndent('  ').convert(data);
                      await Share.shareXFiles([XFile.fromData(utf8.encode(text), mimeType: 'application/json', name: 'dabba-bela-my-data.json')], subject: l.exportData);
                      ref.invalidate(privacyRequestsProvider);
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            SectionCard(
              title: l.deleteAccount,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(l.deleteAccountBody),
                  const SizedBox(height: 12),
                  OutlinedButton(
                    style: OutlinedButton.styleFrom(foregroundColor: BrandColors.sindoor),
                    onPressed: () async {
                      final typed = await promptText(context, title: l.deleteAccount, label: l.typeDelete, maxLines: 1, maxLength: 10, confirmLabel: l.confirm);
                      if (typed == null || !context.mounted) return;
                      if (typed != 'DELETE') {
                        showSnack(context, l.typeDelete);
                        return;
                      }
                      try {
                        final msg = await repo.requestDeletion(null);
                        if (context.mounted && msg.isNotEmpty) showSnack(context, msg);
                      } catch (e) {
                        if (context.mounted) showError(context, e);
                      }
                      ref.invalidate(privacyRequestsProvider);
                    },
                    child: Text(l.deleteAccount),
                  ),
                ],
              ),
            ),
            if (reqs.isNotEmpty) ...[
              const SizedBox(height: 12),
              SectionCard(
                title: l.privacyRequests,
                child: Column(
                  children: [
                    for (final r in reqs)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(r.type == 'DELETE' ? l.deleteAccount : l.exportData),
                        subtitle: Text(KtmDates.timestamp(r.createdAt, locale: context.lang)),
                        trailing: StatusChip(r.status),
                      ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
