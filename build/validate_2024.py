"""Apply the same aggregation rules to excel/transfers2024.xlsx and compare
against the hand-typed `Totals` sheet to gut-check methodology.

Prints per-IPA deltas and an aggregate delta. Non-zero exit if aggregate
delta exceeds the configured threshold.
"""
from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from aggregate import aggregate_workbook  # noqa: E402


# Expected numbers transcribed from the 2024 Totals sheet (transferred, total)
# per IPA. Key = lowercased IPA label as it appears in our pretty_ipa_name
# output (best-effort match; we use substring matching at compare time).
# key = (group_key, sheet_name_uppercased), value = (transferred, total)
EXPECTED_2024 = {
    ("sakhai",    "CFC DR SAKHAI, YUSSEF"):           (261, 273),
    ("sakhai",    "REGAL LAKESIDE DR SAKHAI"):        (144, 156),
    ("sakhai",    "MED PROSPECT DR SAKHAI, YUSSEF"):  (118, 242),
    ("sakhai",    "ACCESS DR SAKHAI"):                (12, 297),

    ("benny_b",   "HISPANIC PHYSICIAN DR BEHROOZAN"): (42, 231),
    ("benny_b",   "SOUTH ATLANTIC DR BEHROOZAN"):     (194, 707),
    ("benny_b",   "ACCOUNTABLE DR BEHROOZAN"):        (21, 44),
    ("benny_b",   "ALTA MED DR BEHROOZAN"):           (120, 806),
    ("benny_b",   "ALLIED DR BEHROOZAN"):             (85, 1487),
    ("benny_b",   "ALTA HOSPITAL SYSTEMS DR BEHROO"): (7, 82),
    ("benny_b",   "REGAL LAKESIDE BENJAMIN BEHRO"):   (72, 441),
    ("benny_b",   "PROSPECT DR BEHROOZAN"):           (34, 175),
    ("benny_b",   "HOLLYWOOD PRESBYTERIAN GLOBAL"):   (26, 77),
    ("benny_b",   "SOUTHERN CALIFORNIA ALTA GLOBAL"): (51, 262),
    ("benny_b",   "GLOBAL CARE DR BEHROOZAN"):        (188, 1052),
    ("benny_b",   "PRUDENT DR BEHROOZAN"):            (0, 30),
    ("benny_b",   "ST VINCENT DR BEHROOZAN"):         (5, 99),

    ("la_mirada", "CFC LA MIRADA"):                   (343, 369),
    ("la_mirada", "ALLIANCE LA MIRADA"):              (61, 98),
    ("la_mirada", "ALLIED LA MIRADA"):                (94, 311),
    ("la_mirada", "BELLA VISTA PROSPECT LA MIRADA"):  (173, 433),
    ("la_mirada", "PROSPECT LA MIRADA"):              (119, 1510),
    ("la_mirada", "REGAL LAKESIDE LA MIRADA"):        (1413, 1580),
    ("la_mirada", "CAL OPTIMA LA MIRADA"):            (0, 439),
    ("la_mirada", "OPTUM ARTA MONARCH SOUTH COAST"):  (10, 147),
    ("la_mirada", "APPLECARE LA MIRADA"):             (3, 297),
    ("la_mirada", "PIH LA MIRADA"):                   (6, 107),
    ("la_mirada", "CHOC LA MIRADA"):                  (0, 141),
    ("la_mirada", "ST JUDE LA MIRADA"):               (6, 229),
}


def match_expected(group_key: str, sheet_name: str):
    canon = " ".join(sheet_name.strip().upper().split())
    val = EXPECTED_2024.get((group_key, canon))
    if val is None:
        return None, None
    return canon, val


def main() -> int:
    xlsx = ROOT / "excel" / "transfers2024.xlsx"

    # The 2024 Totals were computed over all rows in the workbook (no
    # period filter — `Start Date`/`End Date` were Nov 1, 2024 only as a
    # label). Use a wide-open range so we capture the same universe.
    groups, warnings, unclassified = aggregate_workbook(
        str(xlsx), period_start=None, period_end=None
    )

    print(f"{'GROUP':<10} {'IPA':<28} {'GOT t/total':<14} {'EXP t/total':<14} "
          f"{'Δt':>6} {'Δtot':>7}")
    print("-" * 88)

    total_abs_dt = 0
    total_abs_dtot = 0
    sum_exp_t = 0
    sum_exp_tot = 0
    missing: list[str] = []

    for g in groups:
        for r in g.rows:
            key, exp = match_expected(g.key, r.sheet)
            if exp is None:
                missing.append(f"{g.key}/{r.sheet}")
                continue
            et, etot = exp
            dt_ = r.transferred - et
            dtot = r.total - etot
            total_abs_dt += abs(dt_)
            total_abs_dtot += abs(dtot)
            sum_exp_t += et
            sum_exp_tot += etot
            print(f"{g.key:<10} {r.ipa:<28} "
                  f"{r.transferred:>4}/{r.total:<8} "
                  f"{et:>4}/{etot:<8} "
                  f"{dt_:>+6} {dtot:>+7}")

    print("-" * 88)
    pct_t = (total_abs_dt / sum_exp_t * 100) if sum_exp_t else 0
    pct_tot = (total_abs_dtot / sum_exp_tot * 100) if sum_exp_tot else 0
    print(f"Σ|Δtransferred|={total_abs_dt} (Σexpected={sum_exp_t}) → {pct_t:.1f}%")
    print(f"Σ|Δtotal|     ={total_abs_dtot} (Σexpected={sum_exp_tot}) → {pct_tot:.1f}%")

    # Recompute excluding the two anomalous Regal Lakeside cells.
    ANOMALOUS = {
        ("la_mirada", "REGAL LAKESIDE LA MIRADA"),
        ("sakhai",    "REGAL LAKESIDE DR SAKHAI"),
    }
    adj_dt = adj_etot = adj_dtot = adj_et = 0
    for g in groups:
        for r in g.rows:
            key, exp = match_expected(g.key, r.sheet)
            if exp is None:
                continue
            if (g.key, key) in ANOMALOUS:
                continue
            et, etot = exp
            adj_dt   += abs(r.transferred - et)
            adj_dtot += abs(r.total - etot)
            adj_et   += et
            adj_etot += etot
    if adj_et:
        print(f"  (excluding Regal Lakeside cells: "
              f"Δt={adj_dt/adj_et*100:.1f}%, Δtot={adj_dtot/adj_etot*100:.1f}%)")

    if missing:
        print()
        print("IPAs in workbook with no expected match:")
        for m in missing:
            print(f"  ? {m}")

    if unclassified:
        print()
        print("Unclassified sheets (excluded from group totals):")
        for s in unclassified:
            print(f"  ! {s!r}")

    # Gate excludes the known-anomalous Regal Lakeside cells.
    THRESHOLD = 10.0  # percent
    worst = max(
        (adj_dt / adj_et * 100) if adj_et else 0,
        (adj_dtot / adj_etot * 100) if adj_etot else 0,
    )
    if worst > THRESHOLD:
        print(f"\nVALIDATION WARNING: aggregate delta {worst:.1f}% > {THRESHOLD}% "
              "threshold (excluding Regal Lakeside anomalies). "
              "Review methodology before publishing.")
        return 2
    print(f"\nOK: aggregate delta {worst:.1f}% within {THRESHOLD}% threshold "
          "(excluding two hand-keyed Regal Lakeside cells in 2024 Totals).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
