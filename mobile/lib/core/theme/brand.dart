import 'package:flutter/material.dart';

/// Dabba Bela palette — same tokens as tailwind.config.ts / brand/BRAND_GUIDELINES.md.
class BrandColors {
  BrandColors._();

  // ink (charcoal)
  static const ink = Color(0xFF27221D);
  static const inkSoft = Color(0xFF4A423A);
  static const inkMute = Color(0xFF776B5E);
  static const inkLine = Color(0xFFE2D3B5);
  // paper (cream)
  static const paper = Color(0xFFF5EBD6);
  static const paperDeep = Color(0xFFECDDBF);
  static const paperCard = Color(0xFFFFFCF6);
  // sindoor (achar red) — primary actions, prices
  static const sindoor = Color(0xFF8B2923);
  static const sindoorDark = Color(0xFF6C1F1A);
  static const sindoorLight = Color(0xFFF3DEDA);
  // besar (turmeric / haldi) — highlights, focus. Charcoal text on it, never white.
  static const haldi = Color(0xFFE3A83B);
  static const haldiDark = Color(0xFFB47F1E);
  static const haldiLight = Color(0xFFF9EBCB);
  // saag — veg, success
  static const saag = Color(0xFF3B6245);
  static const saagDark = Color(0xFF2B4833);
  static const saagLight = Color(0xFFDDE9DE);
  // akash — info
  static const akash = Color(0xFF2F5D7C);
  static const akashLight = Color(0xFFDCE7EF);
  static const momo = Color(0xFFF1DDB8);

  // Dark-mode surfaces derived from ink.
  static const night = Color(0xFF1B1814);
  static const nightCard = Color(0xFF27221D);
  static const nightLine = Color(0xFF4A423A);
}

/// Semantic status colours (good = saag, warning = haldi, error = sindoor, info = akash).
enum Tone { good, warn, bad, info, neutral }

extension ToneColors on Tone {
  Color background(Brightness b) {
    final dark = b == Brightness.dark;
    switch (this) {
      case Tone.good:
        return dark ? BrandColors.saagDark : BrandColors.saagLight;
      case Tone.warn:
        return dark ? BrandColors.haldiDark : BrandColors.haldiLight;
      case Tone.bad:
        return dark ? BrandColors.sindoorDark : BrandColors.sindoorLight;
      case Tone.info:
        return dark ? BrandColors.akash : BrandColors.akashLight;
      case Tone.neutral:
        return dark ? BrandColors.nightLine : BrandColors.paperDeep;
    }
  }

  Color foreground(Brightness b) {
    final dark = b == Brightness.dark;
    if (dark) return Tone.warn == this ? BrandColors.ink : BrandColors.paper;
    switch (this) {
      case Tone.good:
        return BrandColors.saagDark;
      case Tone.warn:
        return BrandColors.ink;
      case Tone.bad:
        return BrandColors.sindoorDark;
      case Tone.info:
        return BrandColors.akash;
      case Tone.neutral:
        return BrandColors.inkSoft;
    }
  }
}
