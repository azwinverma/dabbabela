import 'package:flutter/material.dart';

import 'brand.dart';

/// Light/dark Material 3 themes from the brand tokens. Body: DM Sans; headlines: Plus Jakarta Sans; Nepali glyphs fall
/// back to Noto Sans Devanagari. Controls are at least 48 dp tall (accessible tap targets).
class AppTheme {
  AppTheme._();

  static const bodyFont = 'DMSans';
  static const displayFont = 'PlusJakartaSans';
  static const devanagariFont = 'NotoSansDevanagari';
  static const _fallback = [devanagariFont];

  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness b) {
    final dark = b == Brightness.dark;
    final scheme = ColorScheme(
      brightness: b,
      primary: dark ? const Color(0xFFE07A6F) : BrandColors.sindoor,
      onPrimary: dark ? BrandColors.ink : Colors.white,
      primaryContainer: dark ? BrandColors.sindoorDark : BrandColors.sindoorLight,
      onPrimaryContainer: dark ? BrandColors.paper : BrandColors.sindoorDark,
      secondary: dark ? const Color(0xFF8DB596) : BrandColors.saag,
      onSecondary: dark ? BrandColors.ink : Colors.white,
      secondaryContainer: dark ? BrandColors.saagDark : BrandColors.saagLight,
      onSecondaryContainer: dark ? BrandColors.paper : BrandColors.saagDark,
      tertiary: BrandColors.haldi,
      onTertiary: BrandColors.ink,
      tertiaryContainer: dark ? BrandColors.haldiDark : BrandColors.haldiLight,
      onTertiaryContainer: BrandColors.ink,
      error: dark ? const Color(0xFFFF8A80) : BrandColors.sindoor,
      onError: dark ? BrandColors.ink : Colors.white,
      surface: dark ? BrandColors.night : BrandColors.paper,
      onSurface: dark ? BrandColors.paper : BrandColors.ink,
      onSurfaceVariant: dark ? const Color(0xFFCFC2AE) : BrandColors.inkSoft,
      surfaceContainerLowest: dark ? BrandColors.night : Colors.white,
      surfaceContainerLow: dark ? BrandColors.nightCard : BrandColors.paperCard,
      surfaceContainer: dark ? BrandColors.nightCard : BrandColors.paperCard,
      surfaceContainerHigh: dark ? const Color(0xFF332D27) : BrandColors.paperDeep,
      surfaceContainerHighest: dark ? const Color(0xFF3D362F) : BrandColors.paperDeep,
      outline: dark ? BrandColors.nightLine : BrandColors.ink,
      outlineVariant: dark ? BrandColors.nightLine : BrandColors.inkLine,
      inverseSurface: dark ? BrandColors.paper : BrandColors.ink,
      onInverseSurface: dark ? BrandColors.ink : BrandColors.paper,
      inversePrimary: BrandColors.haldi,
      shadow: Colors.black,
      scrim: Colors.black54,
    );

    final base = ThemeData(useMaterial3: true, colorScheme: scheme, brightness: b, fontFamily: bodyFont);
    final text = base.textTheme.apply(
      fontFamily: bodyFont,
      fontFamilyFallback: _fallback,
      bodyColor: scheme.onSurface,
      displayColor: scheme.onSurface,
    );
    TextStyle? display(TextStyle? s, FontWeight w) =>
        s?.copyWith(fontFamily: displayFont, fontFamilyFallback: _fallback, fontWeight: w, letterSpacing: -0.3);

    final radius = BorderRadius.circular(12);
    return base.copyWith(
      scaffoldBackgroundColor: scheme.surface,
      textTheme: text.copyWith(
        displayLarge: display(text.displayLarge, FontWeight.w800),
        displayMedium: display(text.displayMedium, FontWeight.w800),
        displaySmall: display(text.displaySmall, FontWeight.w800),
        headlineLarge: display(text.headlineLarge, FontWeight.w800),
        headlineMedium: display(text.headlineMedium, FontWeight.w700),
        headlineSmall: display(text.headlineSmall, FontWeight.w700),
        titleLarge: display(text.titleLarge, FontWeight.w700),
        titleMedium: text.titleMedium?.copyWith(fontWeight: FontWeight.w600),
        titleSmall: text.titleSmall?.copyWith(fontWeight: FontWeight.w600),
        labelLarge: text.labelLarge?.copyWith(fontWeight: FontWeight.w600),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 1,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: displayFont,
          fontFamilyFallback: _fallback,
          fontWeight: FontWeight.w700,
          fontSize: 20,
          color: scheme.onSurface,
        ),
      ),
      cardTheme: CardTheme(
        color: scheme.surfaceContainerLow,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(64, 48),
          shape: RoundedRectangleBorder(borderRadius: radius),
          textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(64, 48),
          shape: RoundedRectangleBorder(borderRadius: radius),
          side: BorderSide(color: scheme.outline, width: 1.5),
          foregroundColor: scheme.onSurface,
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(minimumSize: const Size(48, 48), foregroundColor: scheme.primary),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: dark ? BrandColors.nightCard : Colors.white,
        border: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: scheme.outlineVariant)),
        enabledBorder: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: scheme.outlineVariant)),
        focusedBorder: OutlineInputBorder(borderRadius: radius, borderSide: const BorderSide(color: BrandColors.haldi, width: 2)),
        errorBorder: OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: scheme.error)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      ),
      chipTheme: base.chipTheme.copyWith(
        shape: const StadiumBorder(),
        side: BorderSide(color: scheme.outlineVariant),
        labelStyle: TextStyle(fontFamily: bodyFont, fontFamilyFallback: _fallback, color: scheme.onSurface),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surfaceContainerLow,
        indicatorColor: BrandColors.haldi,
        height: 68,
        labelTextStyle: WidgetStatePropertyAll(
          TextStyle(fontFamily: bodyFont, fontFamilyFallback: _fallback, fontWeight: FontWeight.w600, fontSize: 12, color: scheme.onSurface),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (s) => IconThemeData(color: s.contains(WidgetState.selected) ? BrandColors.ink : scheme.onSurfaceVariant),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: scheme.inverseSurface,
        contentTextStyle: TextStyle(fontFamily: bodyFont, fontFamilyFallback: _fallback, color: scheme.onInverseSurface),
      ),
      dividerTheme: DividerThemeData(color: scheme.outlineVariant, space: 1),
      listTileTheme: ListTileThemeData(minVerticalPadding: 10, iconColor: scheme.onSurfaceVariant),
      materialTapTargetSize: MaterialTapTargetSize.padded,
      visualDensity: VisualDensity.standard,
    );
  }
}
