/* Transfers 2026 Totals dashboard — vanilla JS renderer.

   Schema lives in docs/data.json (see PLAN.md). Every IPA row carries a
   `by_month` map of YYYY-MM -> { transferred, total, adults_*, peds_*,
   shi_t, other_t, adults_shi_t, adults_other_t, peds_shi_t,
   peds_other_t, unknown_age_t, unknown_age_total }.

   All controls mutate a single `state` object; render() reads from it and
   rebuilds #grand-kpis + #groups. No frameworks, no router.
*/

const NEW_GROUPS = new Set(['hanna', 'samala']);
const ALL_GROUP_KEYS = ['hanna', 'samala', 'la_mirada', 'benny_b', 'sakhai'];

const nfInt = new Intl.NumberFormat('en-US');
const nfPct = (x) =>
  Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—';

function pct(num, denom) {
  if (!denom) return null;
  return num / denom;
}
function fmtInt(n)        { return nfInt.format(n || 0); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/* ------------------------------------------------------------------ */
/* Tooltip helper                                                      */
/* ------------------------------------------------------------------ */

/**
 * Wraps `text` in a <span> with a data-tip tooltip.
 * @param {string} text      - visible label text
 * @param {string} tip       - tooltip body (plain text)
 * @param {object} [opts]
 * @param {string} [opts.dir]   - 'down' opens the bubble below (use near page top)
 * @param {string} [opts.align] - 'left' right-aligns bubble (use near right edge)
 * @param {string} [opts.tag]   - wrapper element tag, default 'span'
 */
function tip(text, tipText, { dir, align, tag = 'span' } = {}) {
  const dirAttr   = dir   ? ` data-tip-dir="${dir}"`   : '';
  const alignAttr = align ? ` data-tip-align="${align}"` : '';
  // Escape double-quotes in tipText so it's safe inside an attribute
  const safe = tipText.replace(/"/g, '&quot;');
  return `<${tag} data-tip="${safe}"${dirAttr}${alignAttr}>${text}</${tag}>`;
}

/* ------------------------------------------------------------------ */
/* State                                                              */
/* ------------------------------------------------------------------ */

let DATA = null;              // parsed data.json
let MONTHS = [];              // sorted list of YYYY-MM strings present in the data
let MAX_TOTAL = 0;            // ceiling for the min-total slider

const state = {
  groups: new Set(ALL_GROUP_KEYS),
  segment: 'overall',         // 'overall' | 'adults' | 'peds'
  channel: 'all',             // 'all' | 'shi' | 'other'
  search: '',
  sortBy: 'total',            // 'total' | 'transferred' | 'pct' | 'name'
  sortDir: 'desc',            // 'asc' | 'desc'
  topN: 0,                    // 0 == all
  dedupe: false,
  minTotal: 0,
  bandLo: 0, bandHi: 1,       // 0..1 fraction
  monthLoIdx: 0,
  monthHiIdx: 0,              // set when data loads
};

const DEFAULT_STATE = () => ({
  groups: new Set(ALL_GROUP_KEYS),
  segment: 'overall',
  channel: 'all',
  search: '',
  sortBy: 'total',
  sortDir: 'desc',
  topN: 0,
  dedupe: false,
  minTotal: 0,
  bandLo: 0, bandHi: 1,
  monthLoIdx: 0,
  monthHiIdx: MONTHS.length ? MONTHS.length - 1 : 0,
});

/* ------------------------------------------------------------------ */
/* Bucket math                                                        */
/* ------------------------------------------------------------------ */

const BUCKET_KEYS = [
  'transferred', 'total',
  'adults_t', 'adults_total',
  'peds_t', 'peds_total',
  'other_t', 'shi_t',
  'adults_shi_t', 'adults_other_t',
  'peds_shi_t', 'peds_other_t',
];

function emptyBucket() {
  const o = {};
  for (const k of BUCKET_KEYS) o[k] = 0;
  return o;
}
function addBucket(dst, src) {
  if (!src) return dst;
  for (const k of BUCKET_KEYS) dst[k] += (src[k] || 0);
  return dst;
}

/** Sum monthly buckets within state.[monthLoIdx, monthHiIdx]. */
function sumMonthsForRow(rawRow) {
  const bm = rawRow.by_month || {};
  const out = emptyBucket();
  for (let i = state.monthLoIdx; i <= state.monthHiIdx; i++) {
    const m = bm[MONTHS[i]];
    if (m) addBucket(out, m);
  }
  return out;
}

/** Derive the row the UI actually renders, after segment + channel. */
function deriveRow(rawRow) {
  const b = sumMonthsForRow(rawRow);

  let total, transferred, shi_t, other_t;
  if (state.segment === 'adults') {
    total       = b.adults_total;
    transferred = b.adults_t;
    shi_t       = b.adults_shi_t;
    other_t     = b.adults_other_t;
  } else if (state.segment === 'peds') {
    total       = b.peds_total;
    transferred = b.peds_t;
    shi_t       = b.peds_shi_t;
    other_t     = b.peds_other_t;
  } else {
    total       = b.total;
    transferred = b.transferred;
    shi_t       = b.shi_t;
    other_t     = b.other_t;
  }

  let prominent;
  if (state.channel === 'shi')        prominent = shi_t;
  else if (state.channel === 'other') prominent = other_t;
  else                                 prominent = transferred;

  return {
    _groupKey: rawRow._groupKey,
    _groupIdx: rawRow._groupIdx,
    _rowIdx: rawRow._rowIdx,
    ipa: rawRow.ipa,
    sheet: rawRow.sheet,
    total, transferred, shi_t, other_t,
    adults_t:     b.adults_t,
    adults_total: b.adults_total,
    peds_t:       b.peds_t,
    peds_total:   b.peds_total,
    prominent,
    pct: pct(prominent, total),
  };
}

/* ------------------------------------------------------------------ */
/* Filters + sort                                                     */
/* ------------------------------------------------------------------ */

function passesFilters(r) {
  if (r.total < state.minTotal) return false;
  const q = state.search.trim().toLowerCase();
  if (q && !r.ipa.toLowerCase().includes(q)) return false;
  const bandActive = state.bandLo > 0 || state.bandHi < 1;
  if (bandActive) {
    if (r.pct === null) return false;
    if (r.pct < state.bandLo - 1e-9 || r.pct > state.bandHi + 1e-9) return false;
  }
  return true;
}

function passesFiltersWithoutBand(r) {
  if (r.total < state.minTotal) return false;
  const q = state.search.trim().toLowerCase();
  return !(q && !r.ipa.toLowerCase().includes(q));
}

const SORT_KEYFN = {
  total:       (r) => r.total,
  transferred: (r) => r.prominent,
  pct:         (r) => (r.pct == null ? -1 : r.pct),
  name:        (r) => r.ipa.toLowerCase(),
};

function sortRows(rows) {
  const dir = state.sortDir === 'asc' ? 1 : -1;
  const keyFn = SORT_KEYFN[state.sortBy] || SORT_KEYFN.total;
  const sorted = [...rows].sort((a, b) => {
    const ka = keyFn(a), kb = keyFn(b);
    if (ka < kb) return -1 * dir;
    if (ka > kb) return  1 * dir;
    return 0;
  });
  if (state.topN > 0 && state.topN < sorted.length) {
    return sorted.slice(0, state.topN);
  }
  return sorted;
}

function dedupeKey(r) {
  return r.ipa.trim().toLowerCase().replace(/\s+/g, ' ');
}

function betterDedupeRow(a, b) {
  for (const key of ['total', 'prominent', 'transferred']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? a : b;
  }
  if (a._groupIdx !== b._groupIdx) return a._groupIdx < b._groupIdx ? a : b;
  return a._rowIdx <= b._rowIdx ? a : b;
}

function removeDuplicateRows(groups) {
  if (!state.dedupe) return groups;

  const keepByName = new Map();
  for (const { rows } of groups) {
    for (const r of rows) {
      const key = dedupeKey(r);
      const prev = keepByName.get(key);
      keepByName.set(key, prev ? betterDedupeRow(prev, r) : r);
    }
  }

  const keepIds = new Set(
    Array.from(keepByName.values(), r => `${r._groupKey}:${r._rowIdx}`)
  );

  return groups.map(g => ({
    raw: g.raw,
    rows: g.rows.filter(r => keepIds.has(`${r._groupKey}:${r._rowIdx}`)),
  }));
}

/* ------------------------------------------------------------------ */
/* Header labels (driven by segment + channel)                         */
/* ------------------------------------------------------------------ */

function segmentLabel() {
  return { overall: 'Transferred', adults: 'Adults · T', peds: 'Peds · T' }[state.segment];
}
function channelLabel() {
  return { all: '', shi: ' (SHI)', other: ' (Other)' }[state.channel];
}
function prominentColLabel() {
  // For the table's prominent count column.
  if (state.channel === 'shi')   return 'SHI';
  if (state.channel === 'other') return 'Other';
  return state.segment === 'overall' ? 'T' : (state.segment === 'adults' ? 'Adults T' : 'Peds T');
}
function pctColLabel() {
  const base = state.segment === 'overall' ? '%' :
               (state.segment === 'adults' ? '% Adults' : '% Peds');
  if (state.channel === 'shi')   return base + ' SHI';
  if (state.channel === 'other') return base + ' Other';
  return base;
}
function grandTitle() {
  return `${segmentLabel()}${channelLabel()}`;
}

/* ------------------------------------------------------------------ */
/* KPI cards                                                          */
/* ------------------------------------------------------------------ */

function kpiCard({ label, value, sub, small = false }) {
  return `
    <div class="kpi ${small ? 'kpi-sm' : ''} mount-fade">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
    </div>`;
}

function fmtPctCell(num, denom) {
  const p = pct(num, denom);
  if (p === null) return '<span class="dim">—</span>';
  return `
    <div class="pct-cell">
      <span class="pct-num">${nfPct(p)}</span>
      <span class="pct-bar-track">
        <span class="pct-bar-fill" style="width:${Math.min(100, p * 100).toFixed(1)}%"></span>
      </span>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Render                                                             */
/* ------------------------------------------------------------------ */

function renderGrand(visibleDerivedGroups) {
  // Sum derived (post-filter, post-month) numbers across visible groups.
  const acc = { total: 0, transferred: 0, shi_t: 0, other_t: 0,
                adults_t: 0, adults_total: 0, peds_t: 0, peds_total: 0,
                prominent: 0 };
  let ipaCount = 0;
  for (const { rows } of visibleDerivedGroups) {
    for (const r of rows) {
      acc.total        += r.total;
      acc.transferred  += r.transferred;
      acc.shi_t        += r.shi_t;
      acc.other_t      += r.other_t;
      acc.adults_t     += r.adults_t;
      acc.adults_total += r.adults_total;
      acc.peds_t       += r.peds_t;
      acc.peds_total   += r.peds_total;
      acc.prominent    += r.prominent;
      ipaCount += 1;
    }
  }

  const cards = [
    kpiCard({
      label: tip('Patients in view', 'Total patient count across all visible IPAs and selected groups, after applying the period and min-total filters.'),
      value: fmtInt(acc.total),
      sub: `${ipaCount} IPA${ipaCount === 1 ? '' : 's'} across ${state.groups.size} group${state.groups.size === 1 ? '' : 's'}`,
    }),
    kpiCard({
      label: grandTitle(),
      value: fmtInt(acc.prominent),
      sub: `${nfPct(pct(acc.prominent, acc.total) || 0)} of total`,
    }),
    kpiCard({
      label: tip('SHI share', 'Share of transferred patients routed to an SHI destination. SHI = transfer destination name contains "SHI".'),
      value: nfPct(pct(acc.shi_t, acc.transferred) || 0),
      sub: `${fmtInt(acc.shi_t)} routed to SHI`,
    }),
    kpiCard({
      label: tip('Peds share', 'Share of transferred patients who are pediatric (under 21 at the effective transfer date). Unknown DOBs are counted as adults.'),
      value: nfPct(pct(acc.peds_t, acc.transferred) || 0),
      sub: `${fmtInt(acc.peds_t)} under 21, transferred`,
    }),
  ];
  document.getElementById('grand-kpis').innerHTML = cards.join('');
}

function dimMap() {
  // Which table sub-blocks should be dimmed for the current state.
  const dimAdults = state.segment === 'peds';
  const dimPeds   = state.segment === 'adults';
  const dimOther  = state.channel === 'shi';
  const dimShi    = state.channel === 'other';
  return { dimAdults, dimPeds, dimOther, dimShi };
}

function renderTableRow(r, t, dims) {
  return `
    <tr>
      <td>${r.ipa}</td>
      <td>${fmtInt(r.prominent)}</td>
      <td><span class="dim">${fmtInt(r.total)}</span></td>
      <td>${fmtPctCell(r.prominent, r.total)}</td>
      <td class="${dims.dimAdults ? 'dim-col' : ''}">${fmtInt(r.adults_t)}</td>
      <td class="${dims.dimAdults ? 'dim-col' : ''}"><span class="dim">${fmtInt(r.adults_total)}</span></td>
      <td class="${dims.dimPeds ? 'dim-col' : ''}">${fmtInt(r.peds_t)}</td>
      <td class="${dims.dimPeds ? 'dim-col' : ''}"><span class="dim">${fmtInt(r.peds_total)}</span></td>
      <td class="${dims.dimOther ? 'dim-col' : ''}">${fmtInt(r.other_t)}</td>
      <td class="${dims.dimOther ? 'dim-col' : ''}"><span class="dim">${fmtInt(r.total)}</span></td>
      <td class="${dims.dimShi ? 'dim-col' : ''}">${fmtInt(r.shi_t)}</td>
      <td class="${dims.dimShi ? 'dim-col' : ''}"><span class="dim">${fmtInt(r.total)}</span></td>
    </tr>`;
}

function renderTotalRow(t, dims) {
  return `
    <tr class="row-total">
      <td>Group total</td>
      <td>${fmtInt(t.prominent)}</td>
      <td>${fmtInt(t.total)}</td>
      <td>${fmtPctCell(t.prominent, t.total)}</td>
      <td class="${dims.dimAdults ? 'dim-col' : ''}">${fmtInt(t.adults_t)}</td>
      <td class="${dims.dimAdults ? 'dim-col' : ''}">${fmtInt(t.adults_total)}</td>
      <td class="${dims.dimPeds ? 'dim-col' : ''}">${fmtInt(t.peds_t)}</td>
      <td class="${dims.dimPeds ? 'dim-col' : ''}">${fmtInt(t.peds_total)}</td>
      <td class="${dims.dimOther ? 'dim-col' : ''}">${fmtInt(t.other_t)}</td>
      <td class="${dims.dimOther ? 'dim-col' : ''}">${fmtInt(t.total)}</td>
      <td class="${dims.dimShi ? 'dim-col' : ''}">${fmtInt(t.shi_t)}</td>
      <td class="${dims.dimShi ? 'dim-col' : ''}">${fmtInt(t.total)}</td>
    </tr>`;
}

function tableHeader(dims) {
  const sortCaret = (k) =>
    state.sortBy === k
      ? `<span class="caret"></span>`
      : `<span class="caret" style="opacity:.25"></span>`;
  const sortClass = (k) =>
    `sortable ${state.sortBy === k ? (state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : ''}`;

  return `
    <thead>
      <tr>
        <th rowspan="2" class="${sortClass('name')}" data-sort="name">${tip('IPA', 'Independent Physician Association — the practice or medical group being tracked.')}${sortCaret('name')}</th>
        <th colspan="3" style="text-align:center;border-right:1px solid rgb(39 39 42)">Overall</th>
        <th colspan="2" class="${dims.dimAdults ? 'dim-col' : ''}" style="text-align:center;border-right:1px solid rgb(39 39 42)">Adults</th>
        <th colspan="2" class="${dims.dimPeds ? 'dim-col' : ''}" style="text-align:center;border-right:1px solid rgb(39 39 42)">${tip('Peds', 'Pediatric patients — anyone under 21 years old at the effective transfer date.')} (Under 21)</th>
        <th colspan="2" class="${dims.dimOther ? 'dim-col' : ''}" style="text-align:center;border-right:1px solid rgb(39 39 42)">${tip('Other', 'Transfers sent to any destination that does not contain "SHI" in its name.')}</th>
        <th colspan="2" class="${dims.dimShi ? 'dim-col' : ''}" style="text-align:center">${tip('SHI', 'Transfers routed to a destination whose name contains "SHI" (case-insensitive match on the Transfer To field).')}</th>
      </tr>
      <tr>
        <th class="${sortClass('transferred')}" data-sort="transferred">${prominentColLabel()}${sortCaret('transferred')}</th>
        <th class="${sortClass('total')}" data-sort="total">${tip('Total', 'All non-blank rows with a parseable date in the selected period. Excludes inactive, refused, and no-phone statuses.')}${sortCaret('total')}</th>
        <th class="${sortClass('pct')}" data-sort="pct" style="border-right:1px solid rgb(39 39 42)">${tip(pctColLabel(), 'Transfer rate — transferred patients ÷ total patients for the current segment and channel selection.')}${sortCaret('pct')}</th>
        <th class="${dims.dimAdults ? 'dim-col' : ''}">${tip('T', 'Transferred — adults with a populated Transfer To destination.')}</th>
        <th class="${dims.dimAdults ? 'dim-col' : ''}" style="border-right:1px solid rgb(39 39 42)">Total</th>
        <th class="${dims.dimPeds ? 'dim-col' : ''}">${tip('T', 'Transferred — pediatric patients (under 21) with a populated Transfer To destination.')}</th>
        <th class="${dims.dimPeds ? 'dim-col' : ''}" style="border-right:1px solid rgb(39 39 42)">Total</th>
        <th class="${dims.dimOther ? 'dim-col' : ''}">${tip('T', 'Transferred to Other — patients sent to any non-SHI destination.')}</th>
        <th class="${dims.dimOther ? 'dim-col' : ''}" style="border-right:1px solid rgb(39 39 42)">Total</th>
        <th class="${dims.dimShi ? 'dim-col' : ''}">${tip('T', 'Transferred to SHI — patients routed to an SHI destination.')}</th>
        <th class="${dims.dimShi ? 'dim-col' : ''}">Total</th>
      </tr>
    </thead>`;
}

function renderGroupSection({ raw, rows }, idx) {
  const isNew = NEW_GROUPS.has(raw.key);
  const t = rows.reduce((acc, r) => {
    for (const k of ['total','transferred','shi_t','other_t',
                     'adults_t','adults_total','peds_t','peds_total','prominent']) {
      acc[k] += r[k];
    }
    return acc;
  }, { total:0, transferred:0, shi_t:0, other_t:0,
       adults_t:0, adults_total:0, peds_t:0, peds_total:0, prominent:0 });

  const transferredPct = pct(t.prominent, t.total);
  const shiPct  = pct(t.shi_t, t.transferred);
  const pedsPct = pct(t.peds_t, t.transferred);
  const dims = dimMap();

  const body = rows.length === 0
    ? `<tbody><tr><td colspan="12" class="text-zinc-600 text-center" style="padding:32px">
         No IPAs in this group match the current filters.
       </td></tr></tbody>`
    : `<tbody>
         ${rows.map(r => renderTableRow(r, t, dims)).join('')}
         ${renderTotalRow(t, dims)}
       </tbody>`;

  return `
    <section class="${idx > 0 ? 'mt-16 pt-12 section-divider' : 'mt-4'} mount-fade" data-group="${raw.key}">
      <div class="group-header flex items-end justify-between gap-6 flex-wrap">
        <div>
          <h3>
            ${raw.name}
            ${isNew ? '<span class="badge-new ml-3">New 2026</span>' : ''}
          </h3>
          <div class="group-meta mt-1.5">
            ${raw.subtitle} · ${rows.length} of ${raw.rows.length} IPA${raw.rows.length === 1 ? '' : 's'} shown
          </div>
        </div>
        <div class="text-right">
          <div class="text-xs uppercase tracking-wider text-zinc-500">${pctColLabel()}</div>
          <div class="mt-1 text-white text-2xl font-semibold tabular-nums">
            ${transferredPct === null ? '—' : nfPct(transferredPct)}
          </div>
        </div>
      </div>

      <div class="mt-6 grid grid-cols-2 lg:grid-cols-3 gap-3">
        ${kpiCard({ small: true, label: 'Total patients', value: fmtInt(t.total),
                   sub: `Across ${rows.length} visible IPA${rows.length === 1 ? '' : 's'}` })}
        ${kpiCard({ small: true, label: grandTitle(), value: fmtInt(t.prominent),
                   sub: transferredPct === null ? '—' : `${nfPct(transferredPct)} of total` })}
        ${kpiCard({ small: true, label: tip('SHI / Peds', 'Two rates shown side-by-side: SHI % = SHI transfers ÷ total transferred; Peds % = under-21 transfers ÷ total transferred.'),
                   value: `${shiPct === null ? '—' : nfPct(shiPct)} · ${pedsPct === null ? '—' : nfPct(pedsPct)}`,
                   sub: 'Of transferred patients' })}
      </div>

      <div class="mt-6 rounded-lg border border-zinc-800 overflow-x-auto bg-zinc-950">
        <table class="transfers-table">
          ${tableHeader(dims)}
          ${body}
        </table>
      </div>
    </section>`;
}

function render() {
  // Build derived groups (after group filter + segment + channel + period).
  const filteredGroups = DATA.groups
    .filter(g => state.groups.has(g.key))
    .map(g => ({
      raw: g,
      // Pre-filter rows. Group totals are over the visible-after-filter set,
      // matching the "what you see is what you sum" expectation.
      rows: g.rows.map(deriveRow).filter(passesFilters),
    }));
  const derivedGroups = removeDuplicateRows(filteredGroups)
    .map(g => ({ raw: g.raw, rows: sortRows(g.rows) }));

  renderGrand(derivedGroups);

  const groupsRoot = document.getElementById('groups');
  if (derivedGroups.every(g => g.rows.length === 0)) {
    groupsRoot.innerHTML = `
      <div class="empty-state mt-4 mount-fade">
        <div class="empty-title">No matches</div>
        <div>No IPAs satisfy the current filters. Try widening the band, lowering the min total, or hit Reset.</div>
      </div>`;
  } else {
    groupsRoot.innerHTML = derivedGroups.map(renderGroupSection).join('');
    // Wire per-table header sorts
    groupsRoot.querySelectorAll('th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort');
        if (state.sortBy === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortBy = key;
          state.sortDir = (key === 'name') ? 'asc' : 'desc';
        }
        document.getElementById('ctl-sort').value = `${state.sortBy}:${state.sortDir}`;
        render();
      });
    });
  }

  // Period readout + header period label
  updatePeriodReadout();
  // Slider visuals
  updateFillBars();
  updateHistogram(derivedGroups);
  // Min readout
  document.getElementById('min-readout').textContent =
    state.minTotal === 0 ? 'No minimum' : `≥ ${fmtInt(state.minTotal)} patients`;
  // Band readout
  document.getElementById('band-readout').textContent =
    (state.bandLo === 0 && state.bandHi === 1)
      ? 'Any %'
      : `${(state.bandLo*100).toFixed(0)}% – ${(state.bandHi*100).toFixed(0)}%`;

  // Group chips active state
  document.querySelectorAll('#ctl-groups .chip').forEach(c => {
    c.classList.toggle('on', state.groups.has(c.dataset.key));
  });
  const dedupe = document.getElementById('ctl-dedupe');
  if (dedupe) {
    dedupe.classList.toggle('on', state.dedupe);
    dedupe.textContent = state.dedupe ? 'Show duplicates' : 'Remove duplicates';
    dedupe.title = state.dedupe
      ? 'Show duplicate IPA names across groups'
      : 'Hide duplicate IPA names across groups';
  }
}

/* ------------------------------------------------------------------ */
/* Period label                                                       */
/* ------------------------------------------------------------------ */

function monthLabel(idx) {
  // 'YYYY-MM' -> 'Mon YYYY'
  if (!MONTHS.length) return '—';
  const [y, m] = MONTHS[idx].split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 1));
  return dt.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function updatePeriodReadout() {
  const lo = monthLabel(state.monthLoIdx);
  const hi = monthLabel(state.monthHiIdx);
  const text = state.monthLoIdx === state.monthHiIdx ? lo : `${lo} → ${hi}`;
  document.getElementById('period-readout').textContent = text;
  // Header period label reflects current slider selection.
  const allYear = state.monthLoIdx === 0 && state.monthHiIdx === MONTHS.length - 1;
  document.getElementById('period-label').textContent =
    allYear ? (DATA.period?.label || text) : text;
}

/* ------------------------------------------------------------------ */
/* Slider visuals                                                     */
/* ------------------------------------------------------------------ */

function updateFillBars() {
  // Period
  const pLo = state.monthLoIdx / Math.max(1, MONTHS.length - 1);
  const pHi = state.monthHiIdx / Math.max(1, MONTHS.length - 1);
  setDualFill('ctl-period', pLo, pHi);

  // Min total
  const mFrac = MAX_TOTAL > 0 ? state.minTotal / MAX_TOTAL : 0;
  setSingleFill('ctl-min', mFrac);

  // Band
  setDualFill('ctl-band', state.bandLo, state.bandHi);
}

function setDualFill(rootId, frLo, frHi) {
  const fill = document.querySelector(`#${rootId} .range-fill`);
  if (!fill) return;
  fill.style.left  = `${(frLo * 100).toFixed(2)}%`;
  fill.style.right = `${((1 - frHi) * 100).toFixed(2)}%`;
}
function setSingleFill(rootId, fr) {
  const fill = document.querySelector(`#${rootId} .range-fill`);
  if (!fill) return;
  fill.style.left  = '0%';
  fill.style.right = `${((1 - fr) * 100).toFixed(2)}%`;
}

/* Histogram of % across all visible (group-filtered, period-applied) rows. */
const HIST_BUCKETS = 20;

function updateHistogram(derivedGroups) {
  const counts = new Array(HIST_BUCKETS).fill(0);
  for (const { rows } of derivedGroups) {
    for (const r of rows) {
      if (r.pct === null) continue;
      const idx = clamp(Math.floor(r.pct * HIST_BUCKETS), 0, HIST_BUCKETS - 1);
      counts[idx] += 1;
    }
  }
  // Also include rows filtered out by the band itself, so the histogram
  // doesn't collapse as the user narrows the band. Pull derived rows from
  // raw data with the band momentarily disabled.
  // (Cheap: re-derive without the band filter.)
  const ghostCounts = new Array(HIST_BUCKETS).fill(0);
  const ghostGroups = removeDuplicateRows(DATA.groups
    .filter(g => state.groups.has(g.key))
    .map(g => ({
      raw: g,
      rows: g.rows.map(deriveRow).filter(passesFiltersWithoutBand),
    })));
  for (const { rows } of ghostGroups) {
    for (const r of rows) {
      if (r.pct === null) continue;
      const idx = clamp(Math.floor(r.pct * HIST_BUCKETS), 0, HIST_BUCKETS - 1);
      ghostCounts[idx] += 1;
    }
  }

  const max = Math.max(1, ...ghostCounts);
  const hist = document.getElementById('band-hist');
  hist.innerHTML = '';
  for (let i = 0; i < HIST_BUCKETS; i++) {
    const center = (i + 0.5) / HIST_BUCKETS;
    const inBand = center >= state.bandLo && center <= state.bandHi;
    const h = (ghostCounts[i] / max) * 100;
    const div = document.createElement('div');
    div.className = `tick ${inBand ? 'in' : ''}`;
    div.style.height = `${Math.max(2, h)}%`;
    hist.appendChild(div);
  }
}

/* ------------------------------------------------------------------ */
/* Control rendering & wiring                                         */
/* ------------------------------------------------------------------ */

function buildGroupChips() {
  const root = document.getElementById('ctl-groups');
  root.innerHTML = DATA.groups.map(g =>
    `<button type="button" class="chip on" data-key="${g.key}">${g.name}</button>`
  ).join('');
  root.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.key;
      if (state.groups.has(k)) {
        if (state.groups.size === 1) return; // never empty
        state.groups.delete(k);
      } else {
        state.groups.add(k);
      }
      render();
    });
  });
}

function buildSegmented(rootId, options, stateKey) {
  const root = document.getElementById(rootId);
  root.innerHTML = options.map(([val, label]) =>
    `<button type="button" data-val="${val}" class="${state[stateKey] === val ? 'on' : ''}">${label}</button>`
  ).join('');
  root.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      state[stateKey] = btn.dataset.val;
      root.querySelectorAll('button').forEach(b =>
        b.classList.toggle('on', b.dataset.val === state[stateKey]));
      render();
    });
  });
}

function buildSingleRange(rootId, min, max, step, onInput) {
  const root = document.getElementById(rootId);
  root.innerHTML = `
    <div class="range-track"><div class="range-fill"></div></div>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${min}">
  `;
  const inp = root.querySelector('input');
  inp.addEventListener('input', () => { onInput(Number(inp.value)); });
  return inp;
}

function buildDualRange(rootId, min, max, step, onInput, initialLo, initialHi) {
  const root = document.getElementById(rootId);
  // Preserve any pre-existing children (e.g. histogram) at the front.
  const preserved = Array.from(root.children);
  root.innerHTML = '';
  preserved.forEach(c => root.appendChild(c));

  const track = document.createElement('div');
  track.className = 'range-track';
  const fill = document.createElement('div');
  fill.className = 'range-fill';
  track.appendChild(fill);
  root.appendChild(track);

  const lo = document.createElement('input');
  lo.type = 'range'; lo.min = min; lo.max = max; lo.step = step; lo.value = initialLo;
  const hi = document.createElement('input');
  hi.type = 'range'; hi.min = min; hi.max = max; hi.step = step; hi.value = initialHi;
  root.appendChild(lo);
  root.appendChild(hi);

  function fire() {
    let l = Number(lo.value), h = Number(hi.value);
    if (l > h) { [l, h] = [h, l]; lo.value = l; hi.value = h; }
    onInput(l, h);
  }
  lo.addEventListener('input', fire);
  hi.addEventListener('input', fire);
  return { lo, hi };
}

function buildControls() {
  buildGroupChips();

  buildSegmented('ctl-segment',
    [['overall', 'Overall'], ['adults', 'Adults'], ['peds', 'Peds']],
    'segment');

  buildSegmented('ctl-channel',
    [['all', 'All'], ['shi', 'SHI'], ['other', 'Other']],
    'channel');

  // Search
  const search = document.getElementById('ctl-search');
  search.addEventListener('input', () => { state.search = search.value; render(); });

  // Sort
  const sort = document.getElementById('ctl-sort');
  sort.value = `${state.sortBy}:${state.sortDir}`;
  sort.addEventListener('change', () => {
    const [by, dir] = sort.value.split(':');
    state.sortBy = by; state.sortDir = dir;
    render();
  });

  // Top-N
  const topn = document.getElementById('ctl-topn');
  topn.value = String(state.topN);
  topn.addEventListener('change', () => { state.topN = Number(topn.value); render(); });

  // Duplicate IPA toggle
  document.getElementById('ctl-dedupe').addEventListener('click', () => {
    state.dedupe = !state.dedupe;
    render();
  });

  // Reset
  document.getElementById('ctl-reset').addEventListener('click', () => {
    Object.assign(state, DEFAULT_STATE());
    // Reset DOM controls
    document.getElementById('ctl-search').value = '';
    document.getElementById('ctl-sort').value = 'total:desc';
    document.getElementById('ctl-topn').value = '0';
    rebuildSegmentedActives();
    rebuildSliderValues();
    render();
  });

  // Period slider — quantized to month indices
  const maxIdx = Math.max(0, MONTHS.length - 1);
  buildDualRange('ctl-period', 0, maxIdx, 1, (l, h) => {
    state.monthLoIdx = l; state.monthHiIdx = h; render();
  }, 0, maxIdx);

  // Min-total slider
  const minStep = MAX_TOTAL > 1000 ? 25 : (MAX_TOTAL > 200 ? 10 : 5);
  buildSingleRange('ctl-min', 0, MAX_TOTAL, minStep, (v) => {
    state.minTotal = v; render();
  });

  // % band slider (0..100 integers; mapped to 0..1)
  buildDualRange('ctl-band', 0, 100, 1, (l, h) => {
    state.bandLo = l / 100; state.bandHi = h / 100; render();
  }, 0, 100);
}

function rebuildSegmentedActives() {
  document.querySelectorAll('#ctl-segment button').forEach(b =>
    b.classList.toggle('on', b.dataset.val === state.segment));
  document.querySelectorAll('#ctl-channel button').forEach(b =>
    b.classList.toggle('on', b.dataset.val === state.channel));
}

function rebuildSliderValues() {
  const period = document.querySelectorAll('#ctl-period input[type="range"]');
  if (period.length === 2) {
    period[0].value = state.monthLoIdx;
    period[1].value = state.monthHiIdx;
  }
  const min = document.querySelector('#ctl-min input[type="range"]');
  if (min) min.value = state.minTotal;
  const band = document.querySelectorAll('#ctl-band input[type="range"]');
  if (band.length === 2) {
    band[0].value = state.bandLo * 100;
    band[1].value = state.bandHi * 100;
  }
}

/* ------------------------------------------------------------------ */
/* Methodology footer (unchanged behaviour)                           */
/* ------------------------------------------------------------------ */

function renderMethodology(d) {
  const m = d.methodology || {};
  const excl = (m.total_excludes_status_prefixes || []).join(', ');
  return [
    `<span class="font-mono text-zinc-300">Total</span> = all non-blank rows with a parseable <span class="font-mono text-zinc-300">DATE</span>; use the period slider to restrict to a month range.`,
    `<span class="font-mono text-zinc-300">Transferred</span> = rows with a populated <span class="font-mono text-zinc-300">Transfer&nbsp;to</span> destination (excluding statuses ${excl || '—'}).`,
    `<span class="font-mono text-zinc-300">SHI</span> = transfer destination contains <span class="font-mono text-zinc-300">SHI</span>; <span class="font-mono text-zinc-300">Other</span> = everything else.`,
    `<span class="font-mono text-zinc-300">Peds</span> = age &lt; 21 at the transfer Effective Date (fallback: row DATE). Unknown DOBs bucket into Adults.`,
    `Toolbar controls re-slice the same source: segment (Adults / Peds), channel (SHI / Other), and a month-range slider drawn from per-row dates.`,
  ].join(' ');
}

function showError(msg) {
  document.getElementById('loading').innerHTML =
    `<div class="text-sm text-zinc-300 max-w-md text-center">
       <div class="uppercase tracking-widest text-zinc-500 text-xs mb-3">Load failed</div>
       <div>${msg}</div>
     </div>`;
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  try {
    const res = await fetch('./data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (e) {
    showError(`Could not load data.json (${e.message}).`);
    return;
  }

  MONTHS = Array.isArray(DATA.months) && DATA.months.length
    ? DATA.months
    : (() => {
        // Backwards-compat: derive months if missing.
        const s = new Set();
        for (const g of DATA.groups) for (const r of g.rows)
          for (const k of Object.keys(r.by_month || {})) s.add(k);
        return [...s].sort();
      })();
  state.monthLoIdx = 0;
  state.monthHiIdx = Math.max(0, MONTHS.length - 1);

  // Populate the period slider's fixed endpoint labels.
  document.getElementById('period-bound-lo').textContent = monthLabel(0);
  document.getElementById('period-bound-hi').textContent = monthLabel(MONTHS.length - 1);

  // Max total across all IPAs (for min-total slider ceiling).
  MAX_TOTAL = 0;
  DATA.groups.forEach((g, groupIdx) => {
    g.rows.forEach((r, rowIdx) => {
      r._groupKey = g.key;
      r._groupIdx = groupIdx;
      r._rowIdx = rowIdx;
      if (r.total > MAX_TOTAL) MAX_TOTAL = r.total;
    });
  });
  // Round up to a tidy ceiling
  if (MAX_TOTAL > 0) {
    const pow = Math.pow(10, Math.floor(Math.log10(MAX_TOTAL)));
    MAX_TOTAL = Math.ceil(MAX_TOTAL / pow) * pow;
  }

  document.getElementById('generated-at').textContent =
    DATA.generated_at ? DATA.generated_at.replace('T', ' ') : '—';
  document.getElementById('methodology-text').innerHTML = renderMethodology(DATA);

  buildControls();
  render();

  // Hide loader
  const loader = document.getElementById('loading');
  loader.style.transition = 'opacity 200ms ease-out';
  loader.style.opacity = '0';
  setTimeout(() => loader.remove(), 220);
}

main();
