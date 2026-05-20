"""Generate docs/data.json from excel/transfers2026.xlsx.

Reporting period: YTD 2026 (2026-01-01 .. today).
Methodology: see PLAN.md.
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
    period_start = dt.date(2026, 1, 1)
    period_end = today
    period_label = f"YTD 2026 (Jan 1 – {today.strftime('%b %-d, %Y')})"

    groups, warnings, unclassified = aggregate_workbook(
        str(xlsx), period_start, period_end
    )

    # Build grand totals
    grand = {
        "total": 0, "transferred": 0, "shi_t": 0, "other_t": 0,
        "adults_t": 0, "adults_total": 0, "peds_t": 0, "peds_total": 0,
    }
    for g in groups:
        t = g.totals()
        for k in grand:
            grand[k] += getattr(t, k)

    out = {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "period": {
            "start": period_start.isoformat(),
            "end": period_end.isoformat(),
            "label": period_label,
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
    print(f"Period: {period_start} .. {period_end}")
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
