import 'package:intl/intl.dart';

/// Money is integer paisa everywhere (Rs 1 = 100 paisa). Convert only at the edges — same rules as src/lib/money.ts.
class Money {
  Money._();

  static final _whole = NumberFormat('#,##,##0', 'en_IN');
  static final _dec = NumberFormat('#,##,##0.00', 'en_IN');

  /// "Rs 1,250" (or "Rs 226.50" when there are paisa); Nepali uses "रु". Indian digit grouping like the website.
  static String format(int? paisa, {String locale = 'en', bool? decimals}) {
    final p = paisa ?? 0;
    final neg = p < 0;
    final abs = p.abs();
    final showDec = decimals ?? abs % 100 != 0;
    final body = showDec ? _dec.format(abs / 100) : _whole.format((abs / 100).round());
    final sym = locale == 'ne' ? 'रु' : 'Rs';
    return '${neg ? '−' : ''}$sym $body';
  }

  /// Whole-rupee text for an input field ("200" or "226.50").
  static String toInput(int paisa) => paisa % 100 == 0 ? '${paisa ~/ 100}' : (paisa / 100).toStringAsFixed(2);

  /// Parse "1,250", "Rs 226.5", "रु ५०" into paisa; null when invalid.
  static int? parse(String input) {
    var clean = input.replaceAll(RegExp(r'[,\s]|Rs\.?|रु', caseSensitive: false), '');
    clean = _westernDigits(clean);
    if (clean.isEmpty) return null;
    if (!RegExp(r'^[-+]?\d+(\.\d{1,2})?$').hasMatch(clean)) return null;
    final neg = clean.startsWith('-');
    final parts = clean.replaceFirst(RegExp(r'^[-+]'), '').split('.');
    final whole = int.parse(parts[0]);
    final frac = parts.length > 1 ? int.parse('${parts[1]}00'.substring(0, 2)) : 0;
    final v = whole * 100 + frac;
    return neg ? -v : v;
  }

  static String _westernDigits(String s) {
    const deva = '०१२३४५६७८९';
    final b = StringBuffer();
    for (final ch in s.split('')) {
      final i = deva.indexOf(ch);
      b.write(i >= 0 ? '$i' : ch);
    }
    return b.toString();
  }
}
