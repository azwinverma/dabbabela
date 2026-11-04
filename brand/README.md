# brand/

Source files for the Dabba Bela identity. Read `BRAND_GUIDELINES.md` first.

- **Logos:** `logo-mark.svg`, `wordmark.svg`, `logo-mark-mono.svg`, `logo-inverted.svg`
- **App / social:** `app-icon.svg` (maskable 512 px), `social-card.svg` (1200 × 630)
- **Print:** `packaging-label.svg` (100 × 65 mm dabba label template)

All files are plain SVG (open in Figma, Illustrator or a browser). The website uses the React version of the mark
in `src/components/brand/Logo.tsx`, the favicon in `src/app/icon.svg` and a generated share image at `/opengraph-image`.
Fonts: Plus Jakarta Sans, DM Sans, Noto Sans Devanagari (Google Fonts, SIL OFL). If an SVG's text renders in a fallback
font, install those fonts or convert text to outlines before sending to print.
