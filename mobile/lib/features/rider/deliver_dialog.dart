import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api/api_exception.dart';
import '../../core/format/money.dart';
import '../../core/l10n.dart';
import '../../core/theme/brand.dart';
import '../../core/widgets/common.dart';
import '../../data/ops_repository.dart';
import '../../models/ops.dart';

/// Mark a stop delivered: the customer's 4-digit code (typed by the rider — the app never shows it), cash collected
/// for unpaid cash orders (must equal cashDue), an optional/required photo and a note.
class DeliverDialog extends StatefulWidget {
  const DeliverDialog({super.key, required this.stop, required this.requires, required this.onSubmit, this.picker});

  final RiderStop stop;
  final DeliverRequirements requires;
  final Future<void> Function(DeliverInput input) onSubmit;
  final ImagePicker? picker;

  /// Returns true when the stop was delivered.
  static Future<bool> show(
    BuildContext context, {
    required RiderStop stop,
    required DeliverRequirements requires,
    required Future<void> Function(DeliverInput input) onSubmit,
  }) async =>
      await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (_) => DeliverDialog(stop: stop, requires: requires, onSubmit: onSubmit),
      ) ??
      false;

  @override
  State<DeliverDialog> createState() => _DeliverDialogState();
}

class _DeliverDialogState extends State<DeliverDialog> {
  final _form = GlobalKey<FormState>();
  final _otp = TextEditingController();
  late final _cash = TextEditingController(text: widget.stop.cashDue > 0 ? Money.toInput(widget.stop.cashDue) : '');
  final _note = TextEditingController();
  String? _photo;
  bool _photoMissing = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _otp.dispose();
    _cash.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _pick(ImageSource source) async {
    try {
      final f = await (widget.picker ?? ImagePicker()).pickImage(source: source, maxWidth: 1600, imageQuality: 80);
      if (f != null && mounted) {
        setState(() {
          _photo = f.path;
          _photoMissing = false;
        });
      }
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _submit() async {
    final okForm = _form.currentState!.validate();
    final missing = widget.requires.photo && _photo == null;
    setState(() => _photoMissing = missing);
    if (!okForm || missing) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onSubmit(
        DeliverInput(
          otp: widget.requires.otp ? _otp.text.trim() : null,
          cash: widget.stop.cashDue > 0 ? Money.parse(_cash.text) : null,
          note: _note.text.trim().isEmpty ? null : _note.text.trim(),
          photoPath: _photo,
        ),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? (e.isOffline ? context.l10n.offlineBody : e.message) : '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    final stop = widget.stop;
    final due = stop.cashDue;
    return AlertDialog(
      title: Text(l.riderDeliverTitle(stop.number)),
      scrollable: true,
      content: Form(
        key: _form,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(stop.contactName, style: Theme.of(context).textTheme.titleSmall),
            Text(stop.addressText),
            const SizedBox(height: 12),
            if (_error != null) ...[Notice(_error!, tone: Tone.bad), const SizedBox(height: 12)],
            if (widget.requires.otp) ...[
              TextFormField(
                key: const Key('deliver-otp'),
                controller: _otp,
                autofocus: true,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(4)],
                decoration: InputDecoration(labelText: l.riderOtpLabel, helperText: l.riderOtpHelp, helperMaxLines: 2),
                validator: (v) => RegExp(r'^\d{4}$').hasMatch((v ?? '').trim()) ? null : l.riderOtpInvalid,
              ),
              const SizedBox(height: 12),
            ],
            if (due > 0) ...[
              Notice(l.riderCollect(Money.format(due, locale: context.lang)), tone: Tone.warn, icon: Icons.payments_outlined),
              const SizedBox(height: 8),
              TextFormField(
                key: const Key('deliver-cash'),
                controller: _cash,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(labelText: l.riderCashLabel),
                validator: (v) => Money.parse(v ?? '') == due ? null : l.riderCashMismatch(Money.format(due, locale: context.lang)),
              ),
              const SizedBox(height: 12),
            ] else if (stop.paymentStatus == 'PAID') ...[
              Text(l.riderPrepaid, style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 12),
            ],
            Text('${l.riderPhoto}${widget.requires.photo ? '' : ' (${l.optional})'}', style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 6),
            if (_photo != null)
              Stack(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: Image.file(File(_photo!), height: 140, width: double.infinity, fit: BoxFit.cover),
                  ),
                  Positioned(
                    right: 4,
                    top: 4,
                    child: IconButton.filledTonal(
                      tooltip: l.riderRemovePhoto,
                      onPressed: () => setState(() => _photo = null),
                      icon: const Icon(Icons.close),
                    ),
                  ),
                ],
              )
            else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  OutlinedButton.icon(onPressed: () => _pick(ImageSource.camera), icon: const Icon(Icons.photo_camera_outlined), label: Text(l.riderTakePhoto)),
                  OutlinedButton.icon(onPressed: () => _pick(ImageSource.gallery), icon: const Icon(Icons.photo_library_outlined), label: Text(l.riderChoosePhoto)),
                ],
              ),
            if (_photoMissing)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(l.riderPhotoRequired, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _note,
              maxLength: 300,
              decoration: InputDecoration(labelText: '${l.note} (${l.optional})'),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(false), child: Text(l.cancel)),
        FilledButton(
          key: const Key('deliver-submit'),
          onPressed: _busy ? null : _submit,
          child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.5)) : Text(l.riderDeliver),
        ),
      ],
    );
  }
}

/// Fail a stop with one of the route's reasons ("Other" needs detail).
class FailStopDialog extends StatefulWidget {
  const FailStopDialog({super.key, required this.stop, required this.reasons, required this.onSubmit});

  final RiderStop stop;
  final List<String> reasons;
  final Future<void> Function(String reason, String? detail) onSubmit;

  static Future<bool> show(
    BuildContext context, {
    required RiderStop stop,
    required List<String> reasons,
    required Future<void> Function(String reason, String? detail) onSubmit,
  }) async =>
      await showDialog<bool>(context: context, builder: (_) => FailStopDialog(stop: stop, reasons: reasons, onSubmit: onSubmit)) ?? false;

  @override
  State<FailStopDialog> createState() => _FailStopDialogState();
}

class _FailStopDialogState extends State<FailStopDialog> {
  final _form = GlobalKey<FormState>();
  final _detail = TextEditingController();
  String? _reason;
  bool _busy = false;

  @override
  void dispose() {
    _detail.dispose();
    super.dispose();
  }

  bool get _isOther => _reason == 'Other';

  @override
  Widget build(BuildContext context) {
    final l = context.l10n;
    return AlertDialog(
      title: Text(l.riderFailTitle),
      scrollable: true,
      content: Form(
        key: _form,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.stop.number, style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            for (final r in widget.reasons)
              RadioListTile<String>(
                contentPadding: EdgeInsets.zero,
                value: r,
                groupValue: _reason,
                title: Text(r),
                onChanged: (v) => setState(() => _reason = v),
              ),
            TextFormField(
              controller: _detail,
              maxLength: 300,
              maxLines: 2,
              decoration: InputDecoration(labelText: _isOther ? l.riderFailDetail : '${l.riderFailDetail} (${l.optional})'),
              validator: (v) => _isOther && (v ?? '').trim().isEmpty ? l.required : null,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(false), child: Text(l.cancel)),
        FilledButton(
          onPressed: _busy || _reason == null
              ? null
              : () async {
                  if (!_form.currentState!.validate()) return;
                  setState(() => _busy = true);
                  try {
                    await widget.onSubmit(_reason!, _detail.text.trim().isEmpty ? null : _detail.text.trim());
                    if (context.mounted) Navigator.of(context).pop(true);
                  } catch (e) {
                    if (context.mounted) showError(context, e);
                  } finally {
                    if (mounted) setState(() => _busy = false);
                  }
                },
          child: Text(l.riderFail),
        ),
      ],
    );
  }
}
