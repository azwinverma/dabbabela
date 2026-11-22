#!/usr/bin/env python3
"""Build lib/l10n/app_en.arb + app_ne.arb from l10n_parts/*.json.

Each part keeps English and Nepali side by side so translators review them together:

    { "signIn": { "en": "Sign in", "ne": "लग इन", "description": "optional" },
      "cutoff": { "en": "Order by {time}", "ne": "{time} सम्म अर्डर", "placeholders": { "time": {} } } }

Run from mobile/:  python3 tool/build_arb.py && flutter gen-l10n
Fails on duplicate keys or a missing Nepali string.
"""
import json
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent.parent
parts = sorted((root / "l10n_parts").glob("*.json"))
en = {"@@locale": "en"}
ne = {"@@locale": "ne"}
seen = {}
errors = []
for part in parts:
    data = json.loads(part.read_text(encoding="utf-8"))
    for key, entry in data.items():
        if key in seen:
            errors.append(f"duplicate key {key!r} in {part.name} and {seen[key]}")
            continue
        seen[key] = part.name
        if "en" not in entry or "ne" not in entry:
            errors.append(f"{part.name}: {key!r} needs both 'en' and 'ne'")
            continue
        en[key] = entry["en"]
        ne[key] = entry["ne"]
        meta = {}
        if entry.get("description"):
            meta["description"] = entry["description"]
        if entry.get("placeholders"):
            meta["placeholders"] = entry["placeholders"]
        if meta:
            en["@" + key] = meta
if errors:
    print("\n".join(errors), file=sys.stderr)
    sys.exit(1)
out = root / "lib" / "l10n"
(out / "app_en.arb").write_text(json.dumps(en, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(out / "app_ne.arb").write_text(json.dumps(ne, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"{len(seen)} strings from {len(parts)} parts")
