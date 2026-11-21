# Bundled fonts (mobile)

Static TTF instances generated from the website's self-hosted variable WOFF2 files in `src/app/fonts/`
(Fontsource 5.3.0 subsets of the Google Fonts releases) with `fontTools.varLib.instancer` — Flutter can't load WOFF2
and doesn't reliably apply the `wght` axis of a variable font, so each weight the app uses is its own file.

| Files | Family | Subset | Licence |
|---|---|---|---|
| `PlusJakartaSans-{600,700,800}.ttf` | Plus Jakarta Sans — headlines | Latin | SIL Open Font License 1.1 |
| `DMSans-{400,500,600,700}.ttf` | DM Sans — body & UI | Latin | SIL Open Font License 1.1 |
| `NotoSansDevanagari-{400,600,700}.ttf` | Noto Sans Devanagari — Nepali | Devanagari | SIL Open Font License 1.1 |

OFL 1.1: https://openfontlicense.org — the fonts may be bundled and redistributed with the app; they may not be sold
on their own.
