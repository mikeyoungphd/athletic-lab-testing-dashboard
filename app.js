// app.js — Athletic Lab Performance Testing Dashboard (Static / GitHub Pages)
// Fetches the live Google Sheet client-side via gviz JSONP (no backend needed).
// Preserves all dashboard logic: weekly aggregation, ≥2SD outlier filtering,
// trendlines, transposed table, landscape print.

// ---- Google Sheet config ----
const SHEET_ID = '1d4cbfVxjZAV0GMFM8TfqGxtui-_1egKJS_Jpw7dyrFc';
const SHEET_GID = '0';

// ---- brand colors ----
const RED = '#9C1B20';
const SLATE = '#2D4C62';
const GOLD = '#C8920D';

// ---- exercise → metric mapping (verified against known-good dashboard values) ----
const EXERCISES = [
  { raw: '10-5 Test (Arms Free)',    display: 'Reactive Strength Index', col: 10, agg: 'max', unit: '',    chart: 1, axis: 'y',  color: RED,   dp: 2 },
  { raw: 'Repeated CMJs (Arms Free)', display: 'Vertical Jump',          col: 10, agg: 'max', unit: 'cm',  chart: 1, axis: 'y1', color: SLATE, dp: 2 },
  { raw: 'Push Up',                  display: 'Push Up',                col: 9,  agg: 'max', unit: 'reps', chart: 2, axis: 'y',  color: SLATE, dp: 0 },
  { raw: '5-10-5 Pro Agility Test',  display: '5-10-5 Right',           col: 10, varCol: 8, varVal: 'Right', agg: 'min', unit: 'sec', chart: 3, axis: 'y', color: RED,   dp: 2 },
  { raw: '5-10-5 Pro Agility Test',  display: '5-10-5 Left',            col: 10, varCol: 8, varVal: 'Left',  agg: 'min', unit: 'sec', chart: 3, axis: 'y', color: SLATE, dp: 2 },
  { raw: '30m Sprint Time',          display: '30m Sprint',             col: 9,  agg: 'min', unit: 'sec',  chart: 3, axis: 'y',  color: GOLD,  dp: 2 },
  { raw: 'Nordic Curl',              display: 'Nordic Curl',            col: 12, agg: 'max', unit: 'sec',  chart: 4, axis: 'y',  color: RED,   dp: 2 },
];

const CHART_DEFS = {
  1: { title: 'Jumping Power and Elasticity',  dual: true,  yL: 'RSI',            yR: 'Jump Height (cm)' },
  2: { title: 'Upper Body Power & Endurance',   dual: false, yL: 'Reps',          yR: null },
  3: { title: 'Speed & Change of Direction',   dual: false, yL: 'Duration (s)',  yR: null },
  4: { title: 'Nordic Curl Eccentric Duration', dual: false, yL: 'Duration (s)',  yR: null },
};

let RAW = null;
let ATHLETES = [];
let charts = {};
let currentAthlete = null;

// ---------- date helpers ----------
function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
}
function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
}
function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function mondayTs(ts) {
  const d = new Date(ts);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff).getTime();
}
function weekKey(ts) { return dayKey(mondayTs(ts)); }
function fmtWeekRange(monTs) { return fmtDate(monTs); }

// ---------- client-side data loading via gviz JSONP ----------
// Uses Google Visualization API with JSONP callback — works from any static host
// (GitHub Pages, S3, etc.) without a backend proxy.
function loadSheetJSONP() {
  return new Promise((resolve, reject) => {
    const cbName = '__gviz_cb_' + Date.now();
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=responseHandler:${cbName}&gid=${SHEET_GID}&headers=0`;
    const script = document.createElement('script');
    let done = false;

    window[cbName] = function(data) {
      done = true;
      document.head.removeChild(script);
      delete window[cbName];
      try {
        const csv = gvizToCSV(data);
        resolve(csv);
      } catch (e) {
        reject(new Error('Failed to parse gviz response: ' + e.message));
      }
    };

    script.src = url;
    script.onerror = () => {
      if (!done) {
        if (script.parentNode) document.head.removeChild(script);
        delete window[cbName];
        reject(new Error('Google Sheets request failed'));
      }
    };

    // Timeout after 30s
    setTimeout(() => {
      if (!done) {
        if (script.parentNode) document.head.removeChild(script);
        delete window[cbName];
        reject(new Error('Google Sheets request timed out'));
      }
    }, 30000);

    document.head.appendChild(script);
  });
}

// Convert gviz JSON response to CSV text (same format the old backend returned)
function gvizToCSV(data) {
  if (!data || !data.table || !data.table.rows) throw new Error('Empty gviz response');
  const cols = data.table.cols || [];
  const rows = data.table.rows;
  const lines = [];
  // Header row
  lines.push(cols.map(c => `"${(c.label || c.id || '').replace(/"/g, '""')}"`).join(','));
  // Data rows
  for (const row of rows) {
    const cells = (row.c || []).map(cell => {
      if (!cell || cell.v == null) return '';
      let v = String(cell.v);
      // gviz returns dates as "Date(year,month,day,...)" strings; extract the date
      if (v.startsWith('Date(')) {
        const m = v.match(/Date\((\d+),(\d+),(\d+)/);
        if (m) {
          const yr = +m[1], mo = +m[2] + 1, dy = +m[3];
          v = `${yr}/${String(mo).padStart(2,'0')}/${String(dy).padStart(2,'0')}`;
          // Append time if present
          const tm = v.match(/Date\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/);
          if (tm) v += ` ${String(+tm[4]).padStart(2,'0')}:${String(+tm[5]).padStart(2,'0')}:${String(+tm[6]).padStart(2,'0')}`;
        }
      }
      return `"${v.replace(/"/g, '""')}"`;
    });
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}

// Fallback: try direct CSV fetch (works if Google sends CORS headers)
async function loadSheetCSV() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

// ---------- load + parse ----------
async function load() {
  const status = document.getElementById('status');
  const err = document.getElementById('error');
  try {
    let csv;
    // Try JSONP first (most reliable for static hosting), fall back to CSV fetch
    try {
      csv = await loadSheetJSONP();
    } catch (jsonpErr) {
      console.warn('JSONP failed, trying CSV fetch:', jsonpErr.message);
      csv = await loadSheetCSV();
    }

    if (!csv || csv.length < 100) throw new Error('Empty response from Google Sheets');

    RAW = normalize(csv);
    computeEligible();
    buildDropdown();
    status.textContent = `${ATHLETES.length} eligible athletes · data updated ${new Date().toLocaleTimeString()}`;
    document.getElementById('main').hidden = false;
    render();
  } catch (e) {
    status.textContent = '';
    err.textContent = 'Could not load dashboard data: ' + e.message;
    err.hidden = false;
  }
}

function normalize(csv) {
  const parsed = Papa.parse(csv, { skipEmptyLines: true });
  const rows = parsed.data;
  const recs = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 6) continue;
    const exName = r[0];
    const athlete = (r[4] || '').trim();
    if (!exName || exName === 'Exercise Name') continue;
    if (!athlete || athlete.toLowerCase() === 'free trial') continue;
    const ts = parseDate(r[5]);
    if (ts == null) continue;
    let ex = null;
    for (const e of EXERCISES) {
      if (e.raw !== exName) continue;
      if (e.varCol != null) {
        const v = (r[e.varCol] || '').trim();
        if (v.toLowerCase() !== String(e.varVal).toLowerCase()) continue;
      }
      ex = e; break;
    }
    if (!ex) continue;
    const val = parseFloat(r[ex.col]);
    if (!isFinite(val)) continue;
    recs.push({ athlete, ts, ex: ex.display, val });
  }
  return recs;
}

function computeEligible() {
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const lastByAthlete = {};
  for (const r of RAW) {
    if (r.ts >= cutoff) {
      if (!lastByAthlete[r.athlete] || r.ts > lastByAthlete[r.athlete]) {
        lastByAthlete[r.athlete] = r.ts;
      }
    }
  }
  ATHLETES = Object.keys(lastByAthlete).sort((a, b) => a.localeCompare(b));
}

function buildDropdown() {
  const sel = document.getElementById('athlete');
  sel.innerHTML = '';
  for (const a of ATHLETES) {
    const o = document.createElement('option');
    o.value = a; o.textContent = a;
    sel.appendChild(o);
  }
  const pref = 'Carter Castellano-Staib';
  currentAthlete = ATHLETES.includes(pref) ? pref : (ATHLETES[0] || null);
  if (currentAthlete) sel.value = currentAthlete;
  sel.addEventListener('change', () => { currentAthlete = sel.value; render(); });
}

// ---------- aggregation ----------
function aggByDay(athlete) {
  const map = {};
  for (const r of RAW) {
    if (r.athlete !== athlete) continue;
    const k = dayKey(r.ts);
    if (!map[r.ex]) map[r.ex] = {};
    const cur = map[r.ex][k];
    if (!cur) map[r.ex][k] = { ts: r.ts, val: r.val };
    else {
      const ex = EXERCISES.find(e => e.display === r.ex);
      if (ex.agg === 'max') cur.val = Math.max(cur.val, r.val);
      else cur.val = Math.min(cur.val, r.val);
      cur.ts = r.ts;
    }
  }
  // Collapse to weekly bests
  for (const ex of Object.keys(map)) {
    const daily = map[ex];
    const ex0 = EXERCISES.find(e => e.display === ex);
    const weekly = {};
    for (const dk of Object.keys(daily)) {
      const entry = daily[dk];
      const wk = weekKey(entry.ts);
      const cur = weekly[wk];
      if (!cur) { weekly[wk] = { ts: entry.ts, val: entry.val }; continue; }
      const better = ex0.agg === 'max'
        ? entry.val > cur.val || (entry.val === cur.val && entry.ts > cur.ts)
        : entry.val < cur.val || (entry.val === cur.val && entry.ts > cur.ts);
      if (better) weekly[wk] = { ts: entry.ts, val: entry.val };
    }
    map[ex] = weekly;
  }
  // Outlier filtering
  for (const ex of Object.keys(map)) {
    map[ex] = filterOutliers(map[ex]);
  }
  return map;
}

function filterOutliers(dayMap) {
  const entries = Object.values(dayMap);
  if (entries.length < 3) return dayMap;
  const n = entries.length;
  const mean = entries.reduce((s, e) => s + e.val, 0) / n;
  let ss = 0;
  for (const e of entries) ss += (e.val - mean) * (e.val - mean);
  const sd = Math.sqrt(ss / (n - 1));
  if (!isFinite(sd) || sd <= 1e-9) return dayMap;
  const out = {};
  for (const k of Object.keys(dayMap)) {
    const z = Math.abs((dayMap[k].val - mean) / sd);
    if (z < 2) out[k] = dayMap[k];
  }
  return out;
}

// ---------- charts ----------
function linreg(points) {
  if (!points || points.length < 2) return null;
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  const xs = new Set();
  for (const p of points) {
    if (p.x == null || p.y == null || !isFinite(p.x) || !isFinite(p.y)) continue;
    n++; sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; xs.add(p.x);
  }
  if (n < 2 || xs.size < 2) return null;
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

function render() {
  if (!currentAthlete) return;
  const byDay = aggByDay(currentAthlete);
  for (let c = 1; c <= 4; c++) buildChart(c, byDay);
  buildTable(byDay);
  const pa = document.getElementById('printAthlete');
  if (pa) pa.textContent = currentAthlete;
}

// Theme-aware chart colors
function chartColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    grid: isDark ? '#333231' : '#f0f1f3',
    ticks: isDark ? '#9a9a97' : '#6b7280',
    axisTitle: isDark ? '#6a9ab8' : SLATE,
    legendText: isDark ? '#e0dedc' : '#374151',
  };
}

function buildChart(num, byDay) {
  const def = CHART_DEFS[num];
  const exs = EXERCISES.filter(e => e.chart === num);
  const datasets = [];
  for (const ex of exs) {
    const dayMap = byDay[ex.display];
    if (!dayMap) continue;
    const days = Object.keys(dayMap).map(k => dayMap[k]);
    if (!days.length) continue;
    days.sort((a, b) => a.ts - b.ts);
    datasets.push({
      label: ex.display,
      data: days.map(d => ({ x: d.ts, y: d.val })),
      borderColor: ex.color,
      backgroundColor: ex.color + '20',
      pointBackgroundColor: ex.color,
      pointRadius: 3.5,
      pointHoverRadius: 5,
      borderWidth: 2.2,
      tension: 0.25,
      yAxisID: ex.axis,
      spanGaps: true,
      fill: exs.length === 1 ? 'origin' : false,
    });
    const pts = days.map(d => ({ x: d.ts, y: d.val }));
    const reg = linreg(pts);
    if (reg) {
      const xMin = pts[0].x, xMax = pts[pts.length - 1].x;
      datasets.push({
        label: ex.display + ' (trend)',
        data: [{ x: xMin, y: reg.slope * xMin + reg.intercept }, { x: xMax, y: reg.slope * xMax + reg.intercept }],
        borderColor: ex.color,
        backgroundColor: 'transparent',
        pointRadius: 0, pointHoverRadius: 0,
        borderWidth: 1.6,
        borderDash: [6, 5],
        tension: 0,
        yAxisID: ex.axis,
        spanGaps: true,
        _isTrend: true,
      });
    }
  }

  const nodata = document.getElementById('nodata' + num);
  nodata.hidden = datasets.length > 0;

  if (charts[num]) { charts[num].destroy(); charts[num] = null; }
  const ctx = document.getElementById('chart' + num).getContext('2d');
  if (!datasets.length) return;

  let tsMin = Infinity, tsMax = -Infinity;
  for (const ds of datasets) for (const p of ds.data) {
    if (p.x < tsMin) tsMin = p.x;
    if (p.x > tsMax) tsMax = p.x;
  }
  const pad = (tsMax - tsMin) * 0.02 || 86400000;
  const cc = chartColors();

  const scales = {
    x: {
      type: 'linear',
      min: tsMin - pad,
      max: tsMax + pad,
      ticks: { maxTicksLimit: 6, callback: v => fmtDate(v), color: cc.ticks, maxRotation: 0 },
      grid: { color: cc.grid },
      title: { display: true, text: 'Completed Date', color: cc.ticks, font: { size: 11 } },
    },
    y: {
      position: 'left',
      ticks: { color: cc.ticks },
      grid: { color: cc.grid },
      title: { display: true, text: def.yL, color: cc.axisTitle, font: { size: 12, weight: '600' } },
    },
  };
  if (def.dual && datasets.some(d => d.yAxisID === 'y1')) {
    scales.y1 = {
      position: 'right',
      ticks: { color: cc.ticks, padding: 4 },
      grid: { drawOnChartArea: false },
      title: { display: true, text: def.yR, color: cc.axisTitle, font: { size: 11, weight: '600' }, padding: { top: 4, bottom: 4 } },
    };
  }

  charts[num] = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 6, top: 4 } },
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      plugins: {
        legend: {
          display: true, position: 'top',
          onClick(e, item, legend) {
            const ci = legend.chart;
            const ds = ci.data.datasets[item.datasetIndex];
            if (ds._isTrend) return;
            Chart.defaults.plugins.legend.onClick(e, item, legend);
          },
          labels: {
            boxWidth: 12, boxHeight: 12, font: { size: 11 }, color: cc.legendText,
            filter: (item, data) => !data.datasets[item.datasetIndex]._isTrend,
          },
        },
        tooltip: {
          backgroundColor: 'rgba(26,26,24,0.92)',
          padding: 10,
          cornerRadius: 6,
          callbacks: {
            title: items => fmtDate(items[0].parsed.x),
            label: ctx => {
              const ds = ctx.dataset;
              if (ds._isTrend) return null;
              const ex = EXERCISES.find(e => e.display === ds.label);
              return `${ds.label}: ${fmtVal(ctx.parsed.y, ex)}`;
            },
          },
        },
      },
      scales,
    },
  });
}

// ---------- value formatting ----------
function fmtVal(v, ex) {
  let s = v.toFixed(ex.dp);
  if (ex.unit) s += ' ' + ex.unit;
  return s;
}

// ---------- transposed data table ----------
function buildTable(byDay) {
  const weekSet = {};
  for (const ex of EXERCISES) {
    const dm = byDay[ex.display];
    if (!dm) continue;
    for (const k of Object.keys(dm)) weekSet[k] = mondayTs(dm[k].ts);
  }
  let weeks = Object.keys(weekSet).map(k => ({ k, ts: weekSet[k] }));
  weeks.sort((a, b) => b.ts - a.ts);
  weeks = weeks.slice(0, 12);

  const tbl = document.getElementById('datatable');
  const exRows = EXERCISES.map(e => e.display);

  let html = '<thead><tr><th>Exercise</th>';
  for (const w of weeks) html += `<th>${fmtWeekRange(w.ts)}</th>`;
  html += '</tr></thead><tbody>';
  for (const exDisp of exRows) {
    const ex = EXERCISES.find(e => e.display === exDisp);
    html += `<tr><td>${exDisp}</td>`;
    const dm = byDay[exDisp] || {};
    for (const w of weeks) {
      const cell = dm[w.k];
      if (cell == null) html += '<td class="blank">—</td>';
      else html += `<td>${fmtVal(cell.val, ex)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody>';
  tbl.innerHTML = html;
}

// ---------- dark mode toggle ----------
(function () {
  const t = document.querySelector('[data-theme-toggle]');
  const r = document.documentElement;
  let d = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  r.setAttribute('data-theme', d);
  if (t) {
    t.addEventListener('click', () => {
      d = d === 'dark' ? 'light' : 'dark';
      r.setAttribute('data-theme', d);
      t.setAttribute('aria-label', 'Switch to ' + (d === 'dark' ? 'light' : 'dark') + ' mode');
      t.innerHTML = d === 'dark'
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
      // Re-render charts with new theme colors
      if (currentAthlete) render();
    });
  }
})();

// ---------- init ----------
document.addEventListener('DOMContentLoaded', load);

// ---- print support ----
window.addEventListener('beforeprint', () => {
  for (const k of Object.keys(charts)) { if (charts[k]) charts[k].resize(); }
});
window.addEventListener('afterprint', () => {
  for (const k of Object.keys(charts)) { if (charts[k]) charts[k].resize(); }
});
