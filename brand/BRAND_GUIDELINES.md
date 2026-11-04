# Dabba Bela — brand guidelines

**Dabba Bela / डब्बा बेला** — *dabba* (the lunch box) + *bela* (the time of day). Lunch, on time, wherever you are.
The name is a **working title** until trademark, company-registration, `.com.np` domain and social-handle checks are done (see `docs/IMPLEMENTATION_STATUS.md`, launch blockers). The site reads the brand name from **Admin → Settings**, so a change needs no code.

- Tagline (Nepali): **घरको स्वाद, हरेक दिउँसो।** ("The taste of home, every afternoon.")
- Tagline (English): **Your Lunch. Your Way. Ghar Ko Swad.**

## 1. Who we talk to
Office workers, shop staff, students, shift workers and the people who organise lunch for teams, across Kathmandu at first. Lunch goes to **any address in our delivery areas** — office, shop, college, work site or home. Never write as if we serve offices only.

## 2. Logo

| File | Use |
|---|---|
| `logo-mark.svg` | Primary mark — app icons, favicons, stickers |
| `wordmark.svg` | Mark + "Dabba Bela" + डब्बा बेला — headers, documents, packaging |
| `logo-mark-mono.svg` | One colour (charcoal) — stamps, single-colour print, receipts |
| `logo-inverted.svg` | On charcoal backgrounds |
| `app-icon.svg` | 512 px maskable icon (artwork inside the 80 % safe zone) |
| `social-card.svg` | 1200 × 630 share card (the site also generates `/opengraph-image`) |
| `packaging-label.svg` | 100 × 65 mm dabba label template for the kitchen printer |

**The idea.** A two-tier dabba whose domed lid is a clock face with the hands at 12:30 — lunch *bela*. The geometry is ours: no traditional dabbawala symbols, cap or bicycle motifs are copied.

**Do:** keep clear space around the mark of at least the height of the lid knob × 2; minimum size 24 px (digital), 10 mm (print); use the colour, mono or inverted files as supplied.
**Don't:** recolour parts, stretch, add shadows/gradients/outlines, put the colour mark on busy photos, or redraw the clock hands at another time.

In code: `src/components/brand/Logo.tsx` (`<Logo />`, `<LogoMark mono />`).

## 3. Colour

| Name | Hex | Role | Contrast notes |
|---|---|---|---|
| Achar Red | `#8B2923` | Primary actions, prices, brand accent | White text on it 8.6:1 (AA/AAA) |
| Cream | `#F5EBD6` | Page background | Charcoal on Cream 13.6:1 |
| Saag Green | `#3B6245` | Vegetarian, success, "why it works" | White on it 6.8:1 |
| Charcoal | `#27221D` | Text, outlines, dark sections | — |
| Turmeric | `#E3A83B` | Highlights, stickers, focus ring | Use **Charcoal** text on Turmeric (9.4:1); never white |
| White | `#FFFFFF` | Cards, labels, print | — |

Tailwind tokens: `sindoor`/`achar`, `paper`/`cream`, `saag`, `ink`/`charcoal`, `besar`/`turmeric` (+ `-light`/`-dark` tints). Status colours reuse the palette: good = Saag, warning = Turmeric, error = Achar Red. Avoid gradients except the subtle print grain.

## 4. Typography
All fonts are open-licensed (SIL Open Font License) and self-hosted by `next/font`.

| Use | Font | Weights |
|---|---|---|
| Headlines | **Plus Jakarta Sans** | 700, 800 (tight tracking, −0.02 to −0.03 em) |
| Body & UI | **DM Sans** | 400–700 |
| Nepali | **Noto Sans Devanagari** | 400, 600, 700 (`.lang-ne`) |
| Graffiti accents only | Permanent Marker | Short words (≤ 3), never body text or prices |

Scale: 14 / 16 / 18 body; 24 / 32 / 40 / 56+ headings. Line length 60–75 characters. Nepali text sits 2–4 % larger visually — don't shrink it.

## 5. Spacing, shape, motion
- 4 px base grid; sections breathe at 64–96 px vertical on desktop, 48 px mobile.
- Radius: 12 px controls, 16–24 px cards, full-round chips.
- Outlines: 2 px Charcoal on cards and buttons; "sticker" shadow `4px 4px 0 Charcoal` for primary actions only.
- Motion: ≤ 200 ms, transform/opacity only, purposeful (hover lift, added-to-cart). Everything respects `prefers-reduced-motion`.

## 6. Illustration & graffiti
Hand-drawn SVG kit in `src/components/art`: drips, splatter, scribble underline, starburst sticker, prayer flags, chilli, momo, leaf, rider on a scooter, mountains, and an illustrated top-down dabba (`BoxArt`) used whenever a dish has no photo.

Rules: accents sit **beside or behind non-essential areas**, never under body text, prices or form fields. One or two accents per screen. Cultural motifs (prayer flags, Kathmandu skyline) are used respectfully — no religious imagery on packaging or as decoration near food waste.

## 7. Photography direction
Real food, shot in our kitchen or by a commissioned photographer — **no stock photos of food we don't make**.
- Top-down (90°) for full dabbas on a cream or steel surface; 45° for close-ups of a single dish.
- Daylight from one side, soft shadow, no heavy filters; colours as they look on the plate.
- Show the actual portion in the actual container. Garnish only what's really served.
- Hands welcome (packing, a rider's handover), faces only with written consent.
- Until photos exist the site shows the illustrations; anything placeholder is marked as such in the media library (`isPlaceholder`) and credits are recorded (`credit`).
- Export: 2400 px long edge, JPG/WEBP, sRGB. The site serves resized versions automatically.

## 8. Voice
Warm, specific, useful, Nepal-native. Say what's in the box, when it arrives and what it costs.
- ✓ "Order by 9:30 AM for lunch the same day." ✗ "Experience seamless culinary convenience."
- Natural Nepali phrasing, not word-for-word translation; English words Nepalis actually use (dabba, achar, choila) stay as they are.
- **Truth rules:** no "probiotic", "complete protein", "boosts immunity", disease or weight claims; nutrition only with an *estimated* or *verified* label; no invented customer counts, ratings, partner logos or testimonials (testimonials need recorded consent); allergen copy always mentions the shared kitchen.

## 9. Packaging label
`packaging-label.svg` — 100 × 65 mm thermal label: delivery date + slot, zone/route, big hand-off **code**, customer name or alias, order number, dabba + swaps, VEG/NON-VEG band, allergens and the customer's declared allergies in a red box, and a QR area. The kitchen screen prints the same fields from each order.
