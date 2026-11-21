import 'package:intl/intl.dart';

/// Service dates are `YYYY-MM-DD` Asia/Kathmandu calendar days; timestamps are ISO-8601 UTC. Nepal has no DST, so
/// Kathmandu time is always UTC+05:45 — no timezone database needed.
class KtmDates {
  KtmDates._();

  static const offset = Duration(hours: 5, minutes: 45);

  /// Overridable clock (tests).
  static DateTime Function() now = DateTime.now;

  /// Current wall-clock time in Kathmandu (as a UTC DateTime whose fields read as Kathmandu time).
  static DateTime nowKtm() => now().toUtc().add(offset);

  /// Today's Kathmandu service date, e.g. "2026-11-21".
  static String today() => ymd(nowKtm());

  static String ymd(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  /// "2026-11-21" → DateTime.utc(2026, 11, 21). Null when invalid.
  static DateTime? parse(String? s) {
    if (s == null) return null;
    final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(s);
    if (m == null) return null;
    return DateTime.utc(int.parse(m.group(1)!), int.parse(m.group(2)!), int.parse(m.group(3)!));
  }

  static String addDays(String ymdStr, int days) {
    final d = parse(ymdStr) ?? parse(today())!;
    return ymd(d.add(Duration(days: days)));
  }

  static String _loc(String locale) => locale == 'ne' ? 'ne' : 'en';

  /// Formats with the locale's symbols; falls back to en_US if date symbols weren't initialised.
  static String _fmt(String pattern, String locale, DateTime d) {
    try {
      return DateFormat(pattern, _loc(locale)).format(d);
    } catch (_) {
      return DateFormat(pattern, 'en_US').format(d);
    }
  }

  /// "Mon, 24 Nov" (or Nepali month/day names).
  static String serviceDay(String? ymdStr, {String locale = 'en'}) {
    final d = parse(ymdStr);
    if (d == null) return ymdStr ?? '';
    return _fmt('EEE, d MMM', locale, d);
  }

  /// "Monday, 24 November 2026".
  static String serviceDayLong(String? ymdStr, {String locale = 'en'}) {
    final d = parse(ymdStr);
    if (d == null) return ymdStr ?? '';
    return _fmt('EEEE, d MMMM y', locale, d);
  }

  /// A UTC timestamp shown in Kathmandu time: "24 Nov, 12:30".
  static String timestamp(DateTime? utc, {String locale = 'en'}) {
    if (utc == null) return '';
    final k = utc.toUtc().add(offset);
    return _fmt('d MMM y, HH:mm', locale, k);
  }

  /// Relative label for a service date: today / tomorrow / weekday.
  static bool isToday(String? ymdStr) => ymdStr == today();
  static bool isTomorrow(String? ymdStr) => ymdStr == addDays(today(), 1);
}
