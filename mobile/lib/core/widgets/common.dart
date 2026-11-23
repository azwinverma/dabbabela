import 'package:flutter/material.dart';

import '../api/api_exception.dart';
import '../format/money.dart';
import '../l10n.dart';
import '../theme/brand.dart';

/// Tone for an order / payment / plan / route status code.
Tone toneFor(String status) {
  switch (status) {
    case 'DELIVERED':
    case 'PAID':
    case 'ACTIVE':
    case 'DONE':
    case 'COMPLETED':
    case 'RESOLVED':
    case 'PASS':
      return Tone.good;
    case 'PENDING_PAYMENT':
    case 'PENDING':
    case 'PAUSED':
    case 'OUT_FOR_DELIVERY':
    case 'OUT':
    case 'PREPARING':
    case 'COOKING':
    case 'PARTIALLY_REFUNDED':
      return Tone.warn;
    case 'FAILED':
    case 'FAILED_DELIVERY':
    case 'CANCELLED':
    case 'REJECTED':
    case 'FAIL':
      return Tone.bad;
    case 'SCHEDULED':
    case 'CONFIRMED':
    case 'PACKED':
    case 'PLANNED':
    case 'OPEN':
      return Tone.info;
  }
  return Tone.neutral;
}

class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key, this.label, this.tone});

  final String status;
  final String? label;
  final Tone? tone;

  @override
  Widget build(BuildContext context) {
    final b = Theme.of(context).brightness;
    final t = tone ?? toneFor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: t.background(b), borderRadius: BorderRadius.circular(99)),
      child: Text(
        label ?? context.l10n.statusLabel(status),
        style: TextStyle(color: t.foreground(b), fontWeight: FontWeight.w700, fontSize: 12),
      ),
    );
  }
}

/// Paisa → "Rs 1,250" in the current language.
class MoneyText extends StatelessWidget {
  const MoneyText(this.paisa, {super.key, this.style, this.strong = false});

  final int? paisa;
  final TextStyle? style;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    final base = style ?? Theme.of(context).textTheme.bodyLarge;
    return Text(
      Money.format(paisa, locale: context.lang),
      style: strong ? base?.copyWith(fontWeight: FontWeight.w800, color: Theme.of(context).colorScheme.primary) : base,
    );
  }
}

String rs(BuildContext context, int? paisa) => Money.format(paisa, locale: context.lang);

/// Card with an optional title.
class SectionCard extends StatelessWidget {
  const SectionCard({super.key, this.title, this.trailing, required this.child, this.padding = const EdgeInsets.all(16)});

  final String? title;
  final Widget? trailing;
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: padding,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (title != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Row(
                    children: [
                      Expanded(child: Text(title!, style: Theme.of(context).textTheme.titleMedium)),
                      if (trailing != null) trailing!,
                    ],
                  ),
                ),
              child,
            ],
          ),
        ),
      );
}

/// Label / value row (totals, details).
class InfoRow extends StatelessWidget {
  const InfoRow(this.label, this.value, {super.key, this.bold = false, this.valueWidget});

  final String label;
  final String value;
  final bool bold;
  final Widget? valueWidget;

  @override
  Widget build(BuildContext context) {
    final style = bold ? const TextStyle(fontWeight: FontWeight.w800) : null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: Text(label, style: style)),
          const SizedBox(width: 12),
          Flexible(child: valueWidget ?? Text(value, style: style, textAlign: TextAlign.end)),
        ],
      ),
    );
  }
}

/// Coloured notice box.
class Notice extends StatelessWidget {
  const Notice(this.text, {super.key, this.tone = Tone.info, this.icon, this.action});

  final String text;
  final Tone tone;
  final IconData? icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final b = Theme.of(context).brightness;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: tone.background(b), borderRadius: BorderRadius.circular(12)),
      child: Row(
        children: [
          Icon(icon ?? (tone == Tone.bad ? Icons.warning_amber_rounded : Icons.info_outline), color: tone.foreground(b)),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: TextStyle(color: tone.foreground(b)))),
          if (action != null) action!,
        ],
      ),
    );
  }
}

void showSnack(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

/// Show an error from an action (ApiException message is user-safe).
void showError(BuildContext context, Object error) {
  final l = context.l10n;
  final msg = error is ApiException ? (error.isOffline ? l.offlineBody : error.message) : '$error';
  showSnack(context, msg);
}

Future<bool> confirmDialog(BuildContext context, {required String title, String? body, String? confirmLabel, bool destructive = false}) async {
  final l = context.l10n;
  final ok = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title),
      content: body == null ? null : Text(body),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: Text(l.cancel)),
        FilledButton(
          style: destructive ? FilledButton.styleFrom(backgroundColor: BrandColors.sindoor) : null,
          onPressed: () => Navigator.pop(c, true),
          child: Text(confirmLabel ?? l.confirm),
        ),
      ],
    ),
  );
  return ok ?? false;
}

/// Ask for a line of text (reason, note). Returns null when cancelled.
Future<String?> promptText(
  BuildContext context, {
  required String title,
  String? label,
  String? initial,
  int minLength = 0,
  int maxLength = 300,
  int maxLines = 3,
  String? confirmLabel,
}) async {
  final l = context.l10n;
  final ctrl = TextEditingController(text: initial);
  final key = GlobalKey<FormState>();
  final res = await showDialog<String>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title),
      content: Form(
        key: key,
        child: TextFormField(
          controller: ctrl,
          autofocus: true,
          maxLines: maxLines,
          maxLength: maxLength,
          decoration: InputDecoration(labelText: label),
          validator: (v) => (v ?? '').trim().length < minLength ? l.required : null,
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c), child: Text(l.cancel)),
        FilledButton(
          onPressed: () {
            if (key.currentState!.validate()) Navigator.pop(c, ctrl.text.trim());
          },
          child: Text(confirmLabel ?? l.confirm),
        ),
      ],
    ),
  );
  ctrl.dispose();
  return res;
}

/// A button that runs an async action, shows a spinner while busy and a snackbar on error.
class BusyButton extends StatefulWidget {
  const BusyButton({super.key, required this.label, required this.onPressed, this.icon, this.outlined = false, this.expand = true});

  final String label;
  final Future<void> Function()? onPressed;
  final IconData? icon;
  final bool outlined;
  final bool expand;

  @override
  State<BusyButton> createState() => _BusyButtonState();
}

class _BusyButtonState extends State<BusyButton> {
  bool _busy = false;

  Future<void> _run() async {
    if (_busy || widget.onPressed == null) return;
    setState(() => _busy = true);
    try {
      await widget.onPressed!();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final child = _busy
        ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
        : Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (widget.icon != null) ...[Icon(widget.icon, size: 20), const SizedBox(width: 8)],
              Flexible(child: Text(widget.label, overflow: TextOverflow.ellipsis)),
            ],
          );
    final onPressed = widget.onPressed == null || _busy ? null : _run;
    final btn = widget.outlined ? OutlinedButton(onPressed: onPressed, child: child) : FilledButton(onPressed: onPressed, child: child);
    return widget.expand ? SizedBox(width: double.infinity, child: btn) : btn;
  }
}

/// Bottom-sheet list picker.
Future<T?> pickFromList<T>(BuildContext context, {required String title, required List<T> items, required String Function(T) label, T? selected}) {
  return showModalBottomSheet<T>(
    context: context,
    showDragHandle: true,
    builder: (c) => SafeArea(
      child: ListView(
        shrinkWrap: true,
        children: [
          Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 8), child: Text(title, style: Theme.of(c).textTheme.titleLarge)),
          for (final it in items)
            ListTile(
              title: Text(label(it)),
              trailing: it == selected ? const Icon(Icons.check) : null,
              onTap: () => Navigator.pop(c, it),
            ),
        ],
      ),
    ),
  );
}
