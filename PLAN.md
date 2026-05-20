# Transfers 2026 Totals Dashboard — Plan

## Goal

Reproduce the manual `Totals` view from `excel/transfers2024.xlsx` for the
2026 workbook (`excel/transfers2026.xlsx`), expanded to cover the two
newly acquired groups (Hanna, Samala), and publish it as a static dark
dashboard at https://struv.github.io/transfers-dashboard/.

## Source-of-truth methodology (decided)

For every IPA sub-sheet:

1. Filter to the **reporting period**: YTD 2026 (DATE between 2026-01-01
   and today, inclusive).
2. Exclude rows whose `Transfer Status` (uppercased, trimmed) starts with
   `INACTIVE`, `REFUSED`, `NO PHONE`, or `LEFT MESSAGE`. The remaining
   rows are the **Total**.
3. A row is **Transferred** iff its `Effective Date` cell is a real date.
4. **SHI** vs **Other**: SHI iff `Transfer to` (uppercased) contains the
   substring `SHI`.
5. **Adults** vs **Peds (Under 21)**: age computed at
   `Effective Date ?? DATE`; under 21 is Peds.
6. DOB parsing is tolerant — leading whitespace / tabs are stripped;
   strings like `1/09/1981` are accepted; unparseable rows are logged to
   `docs/data.warnings.json` and excluded from the age split (still
   counted in Total/Transferred).

## Group classification

| Group     | Sheet rule                                         |
|-----------|----------------------------------------------------|
| Hanna     | sheet name contains `HANNA`                        |
| Samala    | sheet name contains `SAMALA`                       |
| Benny B   | sheet name contains `BEHROOZAN`                    |
| Sakhai    | sheet name contains `SAKHAI`                       |
| La Mirada | sheet name contains `LA MIRADA` (and no group above) |

Sheets explicitly excluded from group totals (shared / non-IPA):
`DAILY LIST`, `HEALTH CARE OPTIONS`, `CHDP`, `LA CARE SHI DRS`,
`MOLINA SHI DRS`, `REGAL DRS`, `DRS COMMERCIAL`.

## Repo layout

```
/excel/transfers2026.xlsx     source
/build/build.py               reads xlsx, writes docs/data.json
/build/validate_2024.py       applies same rules to 2024, prints deltas
/docs/                        GitHub Pages root
  index.html
  data.json
  data.warnings.json
  assets/app.js
  assets/styles.css
/PLAN.md                      this file
/style.md                     aesthetic law
```

## Output schema (`docs/data.json`)

```jsonc
{
  "generated_at": "2026-05-19T..",
  "period": { "start": "2026-01-01", "end": "2026-05-19", "label": "YTD 2026" },
  "groups": [
    {
      "key": "hanna",
      "name": "Hanna",
      "subtitle": "Dr. Hanna acquired IPAs",
      "rows": [
        { "ipa": "Karing Physicians", "transferred": 12, "total": 45,
          "adults_t": 3, "adults_total": 10, "peds_t": 9, "peds_total": 35,
          "other_t": 4, "shi_t": 8 }
      ],
      "totals": { /* same keys, summed */ }
    }
  ],
  "grand": { "total": ..., "transferred": ..., "shi_t": ... }
}
```

`Other Total` and `SHI Total` in the rendered table both display the
group/IPA `total` (denominator) — matching the 2024 sheet's convention.

## UI

- Dark, `zinc-950` canvas, `zinc-900` cards, `zinc-800` borders, Inter
  font, white headings, `zinc-400` body, `zinc-500` micro-labels.
- Sticky top bar: title, period, generated-at.
- 4 grand-summary KPI cards.
- Five sections in order — Hanna, Samala, La Mirada, Benny B, Sakhai —
  each: 3 KPI cards + 12-column table with inline `bg-zinc-700`
  percent bars.
- Footer: methodology note + repo link.
- No charts, no framework, no build step. Tailwind via CDN.

## Deploy

1. Run `python3 build/build.py`.
2. Commit `docs/`, `build/`, `PLAN.md`.
3. `git push origin main`.
4. (One-time, manual) GitHub → repo → Settings → Pages → Source:
   Deploy from a branch → `main` / `/docs` → Save.

## Validation gate before publishing

`validate_2024.py` runs the same algorithm against
`excel/transfers2024.xlsx > Totals` and prints, per IPA, the absolute
delta in `transferred` and `total`. If the aggregate delta across all
IPAs is greater than 10%, stop and report; do not silently ship a
different methodology than 2024.
