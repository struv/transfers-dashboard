/* Transfers 2026 Totals dashboard — vanilla JS renderer. */

const NEW_GROUPS = new Set(['hanna', 'samala']);

const nfInt = new Intl.NumberFormat('en-US');
const nfPct = (x) =>
  Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—';

function pct(num, denom) {
  if (!denom) return null;
  return num / denom;
}

function fmtInt(n) {
  return nfInt.format(n || 0);
}

function fmtPct(n, d, opts = {}) {
  const p = pct(n, d);
  if (p === null) return '<span class="dim">—</span>';
  return `
    <div class="pct-cell">
      <span class="pct-num">${nfPct(p)}</span>
      <span class="pct-bar-track">
        <span class="pct-bar-fill" style="width:${Math.min(100, p * 100).toFixed(1)}%"></span>
      </span>
    </div>`;
}

function kpiCard({ label, value, sub, small = false }) {
  return `
    <div class="kpi ${small ? 'kpi-sm' : ''} mount-fade">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
    </div>`;
}

function renderGrand(grand) {
  const totalT = grand.transferred;
  const totalAll = grand.total;
  const shi = grand.shi_t;
  const peds = grand.peds_t;
  const cards = [
    kpiCard({
      label: 'Patients in period',
      value: fmtInt(totalAll),
      sub: 'Non-blank rows across all 5 groups',
    }),
    kpiCard({
      label: 'Transferred',
      value: fmtInt(totalT),
      sub: `${nfPct(pct(totalT, totalAll) || 0)} of total`,
    }),
    kpiCard({
      label: 'SHI share',
      value: nfPct(pct(shi, totalT) || 0),
      sub: `${fmtInt(shi)} routed to SHI`,
    }),
    kpiCard({
      label: 'Peds share',
      value: nfPct(pct(peds, totalT) || 0),
      sub: `${fmtInt(peds)} under 21, transferred`,
    }),
  ];
  document.getElementById('grand-kpis').innerHTML = cards.join('');
}

function renderRow(r, totals) {
  const tPct = pct(r.transferred, r.total);
  return `
    <tr>
      <td>${r.ipa}</td>
      <td>${fmtInt(r.transferred)}</td>
      <td><span class="dim">${fmtInt(r.total)}</span></td>
      <td>${fmtPct(r.transferred, r.total)}</td>
      <td>${fmtInt(r.adults_t)}</td>
      <td><span class="dim">${fmtInt(r.adults_total)}</span></td>
      <td>${fmtInt(r.peds_t)}</td>
      <td><span class="dim">${fmtInt(r.peds_total)}</span></td>
      <td>${fmtInt(r.other_t)}</td>
      <td><span class="dim">${fmtInt(r.total)}</span></td>
      <td>${fmtInt(r.shi_t)}</td>
      <td><span class="dim">${fmtInt(r.total)}</span></td>
    </tr>`;
}

function renderTotalRow(t) {
  return `
    <tr class="row-total">
      <td>Group total</td>
      <td>${fmtInt(t.transferred)}</td>
      <td>${fmtInt(t.total)}</td>
      <td>${fmtPct(t.transferred, t.total)}</td>
      <td>${fmtInt(t.adults_t)}</td>
      <td>${fmtInt(t.adults_total)}</td>
      <td>${fmtInt(t.peds_t)}</td>
      <td>${fmtInt(t.peds_total)}</td>
      <td>${fmtInt(t.other_t)}</td>
      <td>${fmtInt(t.total)}</td>
      <td>${fmtInt(t.shi_t)}</td>
      <td>${fmtInt(t.total)}</td>
    </tr>`;
}

function renderGroup(g, idx) {
  const t = g.totals;
  const isNew = NEW_GROUPS.has(g.key);
  const transferredPct = pct(t.transferred, t.total);
  const shiPct = pct(t.shi_t, t.transferred);
  const pedsPct = pct(t.peds_t, t.transferred);

  return `
    <section class="${idx > 0 ? 'mt-16 pt-12 section-divider' : 'mt-4'} mount-fade">
      <div class="group-header flex items-end justify-between gap-6 flex-wrap">
        <div>
          <h3>
            ${g.name}
            ${isNew ? '<span class="badge-new ml-3">New 2026</span>' : ''}
          </h3>
          <div class="group-meta mt-1.5">
            ${g.subtitle} · ${g.rows.length} IPA${g.rows.length === 1 ? '' : 's'}
          </div>
        </div>
        <div class="text-right">
          <div class="text-xs uppercase tracking-wider text-zinc-500">% Transferred</div>
          <div class="mt-1 text-white text-2xl font-semibold tabular-nums">
            ${transferredPct === null ? '—' : nfPct(transferredPct)}
          </div>
        </div>
      </div>

      <div class="mt-6 grid grid-cols-2 lg:grid-cols-3 gap-3">
        ${kpiCard({ small: true, label: 'Total patients', value: fmtInt(t.total),
                   sub: `Across ${g.rows.length} sub-IPA${g.rows.length === 1 ? '' : 's'}` })}
        ${kpiCard({ small: true, label: 'Transferred', value: fmtInt(t.transferred),
                   sub: transferredPct === null ? '—' : `${nfPct(transferredPct)} of total` })}
        ${kpiCard({ small: true, label: 'SHI / Peds',
                   value: `${shiPct === null ? '—' : nfPct(shiPct)} · ${pedsPct === null ? '—' : nfPct(pedsPct)}`,
                   sub: 'Of transferred patients' })}
      </div>

      <div class="mt-6 rounded-lg border border-zinc-800 overflow-x-auto bg-zinc-950">
        <table class="transfers-table">
          <thead>
            <tr>
              <th rowspan="2">IPA</th>
              <th colspan="3" style="text-align:center;border-right:1px solid rgb(39 39 42)">Overall</th>
              <th colspan="2" style="text-align:center;border-right:1px solid rgb(39 39 42)">Adults</th>
              <th colspan="2" style="text-align:center;border-right:1px solid rgb(39 39 42)">Peds (Under 21)</th>
              <th colspan="2" style="text-align:center;border-right:1px solid rgb(39 39 42)">Other</th>
              <th colspan="2" style="text-align:center">SHI</th>
            </tr>
            <tr>
              <th>T</th><th>Total</th><th style="border-right:1px solid rgb(39 39 42)">%</th>
              <th>T</th><th style="border-right:1px solid rgb(39 39 42)">Total</th>
              <th>T</th><th style="border-right:1px solid rgb(39 39 42)">Total</th>
              <th>T</th><th style="border-right:1px solid rgb(39 39 42)">Total</th>
              <th>T</th><th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${g.rows.map((r) => renderRow(r, t)).join('')}
            ${renderTotalRow(t)}
          </tbody>
        </table>
      </div>
    </section>`;
}

function renderMethodology(d) {
  const m = d.methodology || {};
  const excl = (m.total_excludes_status_prefixes || []).join(', ');
  return [
    `<span class="font-mono text-zinc-300">Total</span> = non-blank rows whose <span class="font-mono text-zinc-300">DATE</span> falls within the period.`,
    `<span class="font-mono text-zinc-300">Transferred</span> = rows with a populated <span class="font-mono text-zinc-300">Transfer&nbsp;to</span> destination (excluding statuses ${excl || '—'}).`,
    `<span class="font-mono text-zinc-300">SHI</span> = transfer destination contains <span class="font-mono text-zinc-300">SHI</span>; <span class="font-mono text-zinc-300">Other</span> = everything else.`,
    `<span class="font-mono text-zinc-300">Peds</span> = age &lt; 21 at the transfer Effective Date (fallback: row DATE). Unknown DOBs bucket into Adults.`,
    `Validated against 2024 Totals: aggregate Δ ≤ 1% on 28 of 30 IPAs. Regal Lakeside cells in the 2024 Totals were hand-keyed with a different ad-hoc rule and are not reproduced.`,
  ].join(' ');
}

function showError(msg) {
  document.getElementById('loading').innerHTML =
    `<div class="text-sm text-zinc-300 max-w-md text-center">
       <div class="uppercase tracking-widest text-zinc-500 text-xs mb-3">Load failed</div>
       <div>${msg}</div>
     </div>`;
}

async function main() {
  let data;
  try {
    const res = await fetch('./data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    showError(`Could not load data.json (${e.message}).`);
    return;
  }

  document.getElementById('period-label').textContent =
    data.period?.label || '—';
  document.getElementById('generated-at').textContent =
    data.generated_at ? data.generated_at.replace('T', ' ') : '—';
  document.getElementById('methodology-text').innerHTML =
    renderMethodology(data);

  renderGrand(data.grand);

  const root = document.getElementById('groups');
  root.innerHTML = data.groups.map(renderGroup).join('');

  // Hide loader
  const loader = document.getElementById('loading');
  loader.style.transition = 'opacity 200ms ease-out';
  loader.style.opacity = '0';
  setTimeout(() => loader.remove(), 220);
}

main();
