"""Generate docs/data.json from excel/transfers2026.xlsx.

No hard-coded period filter — all rows with a parseable DATE are included
and bucketed by YYYY-MM. The frontend period slider lets users slice any
month range interactively. Methodology: see PLAN.md.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
from pathlib import Path

# Allow `python3 build/build.py` from the repo root
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from aggregate import aggregate_workbook  # noqa: E402


def main() -> int:
    xlsx = ROOT / "excel" / "transfers2026.xlsx"
    if not xlsx.exists():
        print(f"ERROR: missing {xlsx}", file=sys.stderr)
        return 1

    today = dt.date.today()

    # No period filter: pass None so every row with a parseable DATE is kept.
    # The month-range slider in the frontend handles time-scoping at display
    # time, so users can freely adjust without needing a rebuild.
    groups, warnings, unclassified = aggregate_workbook(str(xlsx), None, None)

    # Build grand totals (scalar). The client recomputes its own grand
    # rollup when filters change — this is just the unfiltered baseline.
    grand = {
        "total": 0, "transferred": 0, "shi_t": 0, "other_t": 0,
        "adults_t": 0, "adults_total": 0, "peds_t": 0, "peds_total": 0,
        "adults_shi_t": 0, "adults_other_t": 0,
        "peds_shi_t": 0, "peds_other_t": 0,
    }
    for g in groups:
        t = g.totals()
        for k in grand:
            grand[k] += getattr(t, k)

    # Months actually present anywhere in the workbook (union, sorted).
    all_months: set[str] = set()
    for g in groups:
        for r in g.rows:
            all_months.update(r.by_month.keys())
    months_sorted = sorted(all_months)

    out = {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "period": {
            "start": None,
            "end": today.isoformat(),
            "label": f"All data (as of {today.strftime('%b %-d, %Y')})",
        },
        "groups": [
            {
                "key": g.key,
                "name": g.name,
                "subtitle": g.subtitle,
                "rows": [r.to_dict() for r in g.rows],
                "totals": g.totals().to_dict(),
            }
            for g in groups
        ],
        "grand": grand,
        "months": months_sorted,
        "unclassified_sheets": unclassified,
        "methodology": {
            "transferred": "row has a parseable Effective Date",
            "total_excludes_status_prefixes": [
                "INACTIVE", "REFUSED", "NO PHONE", "LEFT MESSAGE"
            ],
            "shi_rule": "'SHI' substring (case-insensitive) in Transfer to",
            "peds_cutoff": "age < 21 at Effective Date (fallback to DATE)",
            "period_filter": "DATE within period_start..period_end inclusive",
        },
    }

    docs = ROOT / "docs"
    docs.mkdir(exist_ok=True)
    (docs / "data.json").write_text(json.dumps(out, indent=2, default=str))
    (docs / "data.warnings.json").write_text(json.dumps(
        [w.__dict__ for w in warnings], indent=2, default=str
    ))

    # Console summary
    print(f"Period: all (no filter)")
    print(f"Groups: {len(groups)}")
    for g in groups:
        t = g.totals()
        pct = (t.transferred / t.total * 100) if t.total else 0
        print(f"  - {g.name:<10} {len(g.rows):>2} IPAs  "
              f"transferred={t.transferred:<5} total={t.total:<5} "
              f"({pct:5.1f}%)")
    print(f"Grand: transferred={grand['transferred']} / total={grand['total']}")
    if unclassified:
        print(f"Unclassified sheets ({len(unclassified)}):")
        for s in unclassified:
            print(f"  ! {s!r}")
    print(f"Warnings: {len(warnings)} (see docs/data.warnings.json)")
    print(f"Wrote {docs/'data.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
