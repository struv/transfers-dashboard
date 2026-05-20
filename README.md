# transfers-dashboard

Static dark dashboard rendering the **2026 Totals** view from
`excel/transfers2026.xlsx`, broken down across the five acquired
groups (Hanna, Samala, La Mirada, Benny B, Sakhai).

Live site: **https://struv.github.io/transfers-dashboard/**

## Layout

```
excel/    Source-of-truth Excel workbooks (2024 + 2026)
build/    Python preprocessor (writes docs/data.json)
docs/     GitHub Pages root (deploy from /docs on main)
PLAN.md   Methodology, rules, and validation gate
style.md  Aesthetic law
```

## Rebuild

```bash
python3 -m pip install --user openpyxl
python3 build/build.py            # writes docs/data.json
python3 build/validate_2024.py    # methodology gut-check vs 2024 Totals
git add docs/ && git commit -m "Refresh 2026 totals" && git push
```

## Methodology (summary)

- **Total** = non-blank rows whose `DATE` falls inside the reporting
  period (default: YTD 2026).
- **Transferred** = `Total` rows with a populated `Transfer to`
  destination (excluding rows whose status is `INACTIVE`, `REFUSED`,
  `NO PHONE`, or `LEFT MESSAGE`).
- **SHI** vs **Other**: `SHI` substring in `Transfer to`.
- **Adults** vs **Peds (Under 21)**: age at `Effective Date` (fallback
  to row `DATE`). Unknown DOBs bucket into Adults.

Validated against the hand-keyed 2024 Totals: aggregate Δ ≤ 1% across 28
of 30 IPAs. See `PLAN.md` for the two known anomalies (Regal Lakeside
cells, which 2024 typed using a different ad-hoc rule).

## Deploy

GitHub → repo → **Settings → Pages → Source: Deploy from a branch →
`main` / `/docs`**. After that, every push to `main` redeploys.
