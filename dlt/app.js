/* 大乐透统计工作台 - 前端逻辑 */
'use strict';
let DRAWS = [];          // 升序 [{issue,date,front:[5],back:[2]}]
let DATA_SRC = '';
let LATEST_META = null;   // 最新一期官方详情：销量/奖池/一二等奖分布
let curPage = 'home';
let pageSize = 50, shown = 0, searchQ = '';
let selFront = new Set(), selBack = new Set();
let fMode = 'include', bMode = 'include';
let lastResult = null;
let statsRange = 0;
let mxTab = 'basic', mxN = 50;

const $ = (s) => document.querySelector(s);
const pad = (n) => (n < 10 ? '0' + n : '' + n);
const pad2 = pad;
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); }
function ballsHtml(front, back, cls) {
  return front.map((r) => `<span class="ball r ${cls}">${pad(r)}</span>`).join('')
    + `<span class="ball sep ${cls}">·</span>`
    + back.map((b) => `<span class="ball b ${cls}">${pad(b)}</span>`).join('');
}

// ===== 数据加载 =====
async function loadData(force) {
  $('#srcInfo').textContent = '数据加载中…';
  let ok = false;
  try {
    const r = await fetch('/api/draws?lotto=dlt' + (force ? '&t=' + Date.now() : ''), { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (j.ok && j.draws && j.draws.length > 100) {
        DRAWS = j.draws; DATA_SRC = j.source; ok = true;
        if (j.latestMeta) LATEST_META = j.latestMeta;
      }
    }
  } catch (e) { console.warn('API失败，尝试快照', e.message); }
  if (!ok) {
    if (!window.__SNAPSHOT__ && !window.__snapLoading) {
      window.__snapLoading = true;
      await new Promise((res) => {
        const s = document.createElement('script'); s.src = 'snapshot.js'; s.onload = s.onerror = res;
        document.head.appendChild(s);
      });
    }
    if (window.__SNAPSHOT__ && window.__SNAPSHOT__.draws) {
      DRAWS = window.__SNAPSHOT__.draws; DATA_SRC = '内置快照';
      LATEST_META = window.__SNAPSHOT__.latestMeta || null;
    } else throw new Error('无可用数据');
  }
  DRAWS.sort((a, b) => a.issue < b.issue ? -1 : a.issue > b.issue ? 1 : 0);
  $('#srcInfo').textContent = `${DRAWS.length}期 · ${DRAWS[0].date.slice(0,4)}-${DRAWS[DRAWS.length-1].date.slice(0,4)} · ${DATA_SRC} · v${window.DLT_VERSION || '?'}`;
  renderAll();
}

function renderAll() {
  try { renderLatest(); } catch (e) { console.error('renderLatest:', e); }
  try { resetList(); } catch (e) { console.error('resetList:', e); }
  try { renderPickArea(); } catch (e) { console.error('renderPickArea:', e); }
  try { renderSelInfo(); } catch (e) { console.error('renderSelInfo:', e); }
  try { renderStats(); } catch (e) { console.error('renderStats:', e); }
  try { renderTrend(); } catch (e) { console.error('renderTrend:', e); }
  if (lastResult) try { renderQueryResult(); } catch (e) { console.error('renderQueryResult:', e); }
}

// ===== 首页 =====
function renderLatest() {
  if (!DRAWS.length) return;
  const d = DRAWS[DRAWS.length - 1];
  const S = DLTStats;
  const zc = S.fzoneCounts(d);
  const zcStr = zc.map((n, i) => `${i + 1}区${n}`).join(' ');
  const meta = [
    `前区和值 ${S.fsumOf(d)}`, `后区和值 ${S.backsumOf(d)}`,
    `前区单双 ${S.foeOf(d)}`, `前区大小 ${S.fbsOf(d)}`,
    `跨度 ${S.fspanOf(d)}`, zcStr,
    S.fconsecOf(d).length ? `连号 ${S.fconsecOf(d).map((g) => g.join(',')).join(' / ')}` : '无连号',
  ];
  const m = LATEST_META;
  const money = (n) => {
    if (typeof n === 'string') n = parseInt(n.replace(/,/g, ''), 10) || 0;
    return n >= 1e8 ? (n / 1e8).toFixed(2) + '亿' : n >= 1e4 ? (n / 1e4).toFixed(0) + '万' : n;
  };
  const safeNum = (v) => (v == null ? 0 : v);
  // 大乐透奖级：一二三...九等
  const prizeNames = ['', '一等奖', '二等奖', '三等奖', '四等奖', '五等奖', '六等奖', '七等奖', '八等奖', '九等奖'];
  const prizes = (m && Array.isArray(m.prizes)) ? m.prizes : [];
  let prizeRows = '';
  if (prizes.length) {
    prizeRows = prizes.filter((p) => safeNum(p.num) > 0).map((p) => {
      const pname = (p.type >= 1 && p.type < prizeNames.length) ? prizeNames[p.type] : ('奖' + (p.type || '?'));
      return `<div class="prizeRow"><span class="pn">${pname}</span>
      <span class="pc">${safeNum(p.num).toLocaleString()} 注</span>
      <span class="pm">¥${money(safeNum(p.money))}</span></div>`;
    }).join('');
  }
  const j1 = safeNum(m && (m.j1_cnt || (prizes[0] && prizes[0].num)));
  const j2 = safeNum(m && (m.j2_cnt || (prizes[1] && prizes[1].num)));
  const officialBlock = m ? `
    <div class="officialBox">
      <div class="ob-title">📊 全国中奖情况（来源：500彩票网）</div>
      <div class="ob-stats">
        <div><div class="ol">本期销量</div><div class="ov">¥${money(m.sales || m.total || 0)}</div></div>
        <div><div class="ol">奖池滚存</div><div class="ov">¥${money(m.poolmoney || m.pool || 0)}</div></div>
        <div><div class="ol">一等奖</div><div class="ov">${j1} 注</div></div>
        <div><div class="ol">二等奖</div><div class="ov">${j2} 注</div></div>
      </div>
      ${prizeRows ? `<div class="ob-prizes">${prizeRows}</div>` : ''}
    </div>` : '<div class="officialBox"><div class="ob-title">全国中奖详情加载中…</div></div>';
  $('#latestBox').innerHTML = `
  <div class="latest">
    <div class="row1">
      <span class="issue">${d.issue}</span><span class="date">${d.date}</span>
      <span class="tag">最新一期</span>
    </div>
    <div class="balls">${ballsHtml(d.front, d.back, 'lg')}</div>
    <div class="meta">${meta.map((mm) => `<span>${mm}</span>`).join('')}</div>
    ${officialBlock}
  </div>`;
}

function drawRows() {
  const q = searchQ.trim();
  const rows = [];
  for (let i = DRAWS.length - 1; i >= 0; i--) {
    const d = DRAWS[i];
    if (q) {
      if (d.issue !== q && d.issue.slice(-q.length) !== q && d.issue.slice(-3) !== q) continue;
    }
    rows.push(d);
  }
  return rows;
}
function resetList() { shown = pageSize; $('#drawCount').textContent = `共 ${DRAWS.length} 期`; renderList(); }
function renderList() {
  const rows = drawRows();
  const slice = rows.slice(0, shown);
  const box = $('#drawList');
  if (!slice.length) { box.innerHTML = '<div class="loading">没有匹配的期号</div>'; $('#moreBtn').style.display = 'none'; return; }
  box.innerHTML = slice.map((d) => `
    <div class="drawRow">
      <div class="info"><div class="iss">${d.issue}</div><div class="dt">${d.date}</div></div>
      <div class="nums">${ballsHtml(d.front, d.back, 'sm')}</div>
    </div>`).join('');
  $('#moreBtn').style.display = shown < rows.length ? 'block' : 'none';
  $('#moreBtn').textContent = `加载更多（剩余 ${rows.length - shown} 期）`;
}
$('#moreBtn').onclick = () => { shown += pageSize; renderList(); };
$('#searchInput').oninput = (e) => { searchQ = e.target.value; shown = pageSize; renderList(); };
$('#clearSearch').onclick = () => { $('#searchInput').value = ''; searchQ = ''; resetList(); };

// ===== 查询页 =====
function pickZoneHtml(title, max, selectedSet, cssClass, groupName) {
  let html = `<div class="pickZone"><div class="pzh">${title}</div><div class="pzg">`;
  for (let n = 1; n <= max; n++) {
    const on = selectedSet.has(n) ? 'on' : '';
    html += `<button class="ballpick ${cssClass} ${on}" data-n="${n}" data-g="${groupName}">${pad(n)}</button>`;
  }
  html += `</div></div>`;
  return html;
}
function renderPickArea() {
  const box = $('#pickArea');
  box.innerHTML = `
    <div class="seg" id="modeSegF" style="margin-top:0;margin-bottom:8px">
      <button data-mode="include" class="${fMode==='include'?'on':''}">前区包含</button>
      <button data-mode="exact" class="${fMode==='exact'?'on':''}">前区精确</button>
    </div>
    ${pickZoneHtml('前区 01-35', 35, selFront, 'r', 'f')}
    <div class="seg" id="modeSegB" style="margin-top:8px;margin-bottom:8px">
      <button data-mode="include" class="${bMode==='include'?'on':''}">后区包含</button>
      <button data-mode="exact" class="${bMode==='exact'?'on':''}">后区精确</button>
    </div>
    ${pickZoneHtml('后区 01-12', 12, selBack, 'b', 'b')}`;
  box.querySelectorAll('.ballpick').forEach((b) => {
    b.onclick = () => {
      const n = +b.dataset.n, g = b.dataset.g;
      const set = g === 'f' ? selFront : selBack;
      if (set.has(n)) { set.delete(n); b.classList.remove('on'); }
      else { set.add(n); b.classList.add('on'); }
      renderSelInfo();
    };
  });
  $('#modeSegF').querySelectorAll('button').forEach((x) => x.onclick = () => {
    fMode = x.dataset.mode;
    $('#modeSegF').querySelectorAll('button').forEach((y) => y.classList.toggle('on', y === x));
  });
  $('#modeSegB').querySelectorAll('button').forEach((x) => x.onclick = () => {
    bMode = x.dataset.mode;
    $('#modeSegB').querySelectorAll('button').forEach((y) => y.classList.toggle('on', y === x));
  });
}

function renderSelInfo() {
  const f = [...selFront].sort((a, b) => a - b).map((n) => pad(n)).join(' ');
  const b = [...selBack].sort((a, b) => a - b).map((n) => pad(n)).join(' ');
  const info = `前区[${f || '空'}] · 后区[${b || '空'}]`;
  $('#selInfo').textContent = info;
  $('#queryBtn').disabled = !(selFront.size || selBack.size);
  $('#clearPick').onclick = () => { selFront.clear(); selBack.clear(); renderPickArea(); renderSelInfo(); };
  $('#queryBtn').onclick = doQuery;
}

function doQuery() {
  if (!DRAWS.length) return;
  if (!selFront.size && !selBack.size) { toast('请至少选 1 个号码'); return; }
  lastResult = DLTStats.query(DRAWS, [...selFront], [...selBack], fMode, bMode);
  renderQueryResult();
}

function renderQueryResult() {
  const r = lastResult;
  const box = $('#queryResult');
  if (!r) return;
  const head = `<div class="card">
    <h3>查询结果 <span class="tail">命中 ${r.count} 期</span></h3>
    <div class="hint" style="margin-bottom:8px">前区[${r.selF.map(pad).join(' ') || '任意'}] ${fMode==='exact'?'精确':'包含'} · 后区[${r.selB.map(pad).join(' ') || '任意'}] ${bMode==='exact'?'精确':'包含'}</div>
    <div class="seg" id="resTab">
      <button data-k="hits" class="on">命中 (${r.count})</button>
      <button data-k="nexts">下期汇总</button>
    </div>
  </div><div id="resBody"></div>`;
  box.innerHTML = head;
  $('#resTab').querySelectorAll('button').forEach((b) => b.onclick = () => {
    $('#resTab').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderResBody(b.dataset.k);
  });
  renderResBody('hits');
}

function renderResBody(key) {
  const body = $('#resBody');
  const r = lastResult;
  if (key === 'hits') {
    if (!r.hits.length) { body.innerHTML = '<div class="card"><div class="loading">无命中</div></div>'; return; }
    body.innerHTML = r.hits.slice(0, 60).map((h) => `
      <div class="card">
        <h3>${h.issue} <span class="tail">${h.date}</span></h3>
        <div class="nums">${ballsHtml(h.front, h.back, 'sm')}</div>
        <div class="meta" style="margin-top:6px">
          <span>和值 ${h.sum}</span><span>单双 ${h.foe}</span><span>跨度 ${h.fspan || h.span || ''}</span>
          ${h.fconsec && h.fconsec.length ? `<span>连号 ${h.fconsec.map((g) => g.join(',')).join(' / ')}</span>` : ''}
        </div>
        ${h.next ? `<div class="hint" style="margin-top:6px">下期 ${h.next.issue} · ${h.next.date}：${ballsHtml(h.next.front, h.next.back, 'sm')}</div>` : ''}
      </div>
    `).join('') + (r.hits.length > 60 ? `<div class="card"><div class="hint">… 还有 ${r.hits.length - 60} 期未显示</div></div>` : '');
  } else {
    const s = r.nextStats;
    if (!s) { body.innerHTML = '<div class="card"><div class="loading">无下期数据可汇总</div></div>'; return; }
    body.innerHTML = `
      <div class="card">
        <h3>下期汇总 <span class="tail">共 ${s.total} 期</span></h3>
        <div class="hint">前区和值均值：<b>${s.avgSum}</b>　前区连号率：<b>${s.fconsecRate}%</b>　前区重号率：<b>${s.freqRepRate}%</b>　后区重号率：<b>${s.bRepRate}%</b></div>
        <div class="hint" style="margin-top:8px">前区热门号 TOP12：${s.fTop.map(([n, c]) => `${pad(n)}(${c})`).join('、')}</div>
        <div class="hint" style="margin-top:4px">后区热门号 TOP8：${s.bTop.map(([n, c]) => `${pad(n)}(${c})`).join('、')}</div>
      </div>`;
  }
}

// ===== 统计页 =====
function renderStats() {
  const S = DLTStats;
  const range = statsRange > 0 ? DRAWS.slice(-statsRange) : DRAWS;
  const b = S.basicStats(range);
  if (!b) { $('#statsBox').innerHTML = '<div class="loading">无数据</div>'; return; }
  const drawBars = (entries, max) => {
    const m = max || Math.max(...entries.map(([, c]) => c), 1);
    return entries.slice(0, 12).map(([k, c]) => `<div class="barRow"><div class="barLbl">${esc(String(k))}</div><div class="bar"><div class="barI" style="width:${(c/m*100).toFixed(1)}%"></div></div><div class="barCnt">${c}</div></div>`).join('');
  };
  $('#statsBox').innerHTML = `
    <div class="statGrid">
      <div class="statCard"><div class="lbl">前区连号率</div><div class="val">${b.fconsec.rate}%</div><div class="sub">2连 ${b.fconsec.two[1]}% · 3连 ${b.fconsec.three[1]}% · 4+连 ${b.fconsec.fourPlus[1]}%</div></div>
      <div class="statCard"><div class="lbl">前区重号率</div><div class="val">${b.freqRep.rate}%</div><div class="sub">${b.freqRep.issues} 期含重号</div></div>
      <div class="statCard"><div class="lbl">前区和值</div><div class="val">${b.sum.avg}</div><div class="sub">${b.sum.min} ~ ${b.sum.max} · 中位 ${b.sum.median}</div></div>
      <div class="statCard"><div class="lbl">后区和值</div><div class="val">${b.bsum.avg}</div><div class="sub">${b.bsum.min} ~ ${b.bsum.max} · 中位 ${b.bsum.median}</div></div>
    </div>
    <div class="card" style="margin-top:12px">
      <h3>前区单双比</h3>
      ${drawBars(b.foe)}
    </div>
    <div class="card">
      <h3>前区大小比 (1-17小 / 18-35大)</h3>
      ${drawBars(b.fbs)}
    </div>
    <div class="card">
      <h3>跨度分布</h3>
      ${drawBars(b.span, 60)}
    </div>
  `;
  $('#rangeSeg').querySelectorAll('button').forEach((b) => b.onclick = () => {
    statsRange = +b.dataset.n;
    $('#rangeSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderStats();
  });
}

// ===== 走势页 =====
function renderTrend() {
  renderNumberList(DRAWS);
  $('#trendSeg').querySelectorAll('button').forEach((b) => b.onclick = () => {
    mxTab = b.dataset.t;
    $('#trendSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderNumberList(DRAWS);
  });
}

function renderNumberList(draws) {
  if (!draws.length) return;
  const m = DLTStats.matrixNum(draws, mxN, null);
  const showFront = mxTab !== 'back';
  const showBack = mxTab !== 'front';

  const display = m.rows.map((row, ri) => ({ row, sIdx: m.sliceLen - 1 - ri })).reverse();
  let rowsHtml = '';
  display.forEach(({ row, sIdx }) => {
    let html = `<th class="mx-issue">${row.issue.slice(-3)}<br><span class="mx-date">${row.date.slice(5)}</span></th>`;
    if (showFront) {
      row.frontCells.forEach((c) => {
        if (c.hit) html += `<td class="mx2-cell hit"><span class="mx2-ball r">${pad(c.num)}</span></td>`;
        else html += `<td class="mx2-cell" style="background:${cellBg(c.miss)}">${c.miss}</td>`;
      });
    } else { html += `<td colspan="35" class="mx2-blank"></td>`; }
    html += `<td class="mx2-sep"></td>`;
    if (showBack) {
      row.backCells.forEach((c) => {
        if (c.hit) html += `<td class="mx2-cell hit col-b${pad2(c.num)}"><span class="mx2-ball b">${pad(c.num)}</span></td>`;
        else {
          let miss = 0;
          for (let i = sIdx; i >= 0; i--) { if (draws[draws.length - m.sliceLen + i].back.includes(c.num)) break; miss++; }
          html += `<td class="mx2-cell" style="background:${cellBg(miss)}">${miss}</td>`;
        }
      });
    } else { html += `<td colspan="12" class="mx2-blank"></td>`; }
    if (mxTab === 'basic') {
      html += `<td class="deriv-c">${row.derivs.sum}</td><td class="deriv-c">${row.derivs.span}</td><td class="deriv-c">${row.derivs.zones}</td><td class="deriv-c">${row.derivs.foe}</td>`;
    } else { html += `<td colspan="4" class="mx2-blank"></td>`; }
    rowsHtml += `<tr>${html}</tr>`;
  });

  let lineLayer = '';
  if (showBack && (mxTab === 'basic' || mxTab === 'back')) {
    const cell = 32, issueW = 56, sepW = 2, headH = 24 + cell;
    const backColStart = 1 + (showFront ? 35 : 0) + 1;
    const n = m.rows.length;
    const colCount = (showFront ? 35 : 0) + 1 + 12 + (mxTab === 'basic' ? 4 : 0);
    const w = issueW + colCount * cell;
    const h = headH + n * cell + cell + 1;
    const startX = issueW + backColStart * cell;
    // 路径初值（render 后用 alignLine 二次校准）
    const b0Pts = m.rows.map((row, i) => {
      const c = row.backCells.find((cc) => cc.hit && cc.num === row.back[0]);
      const dy = n - 1 - i;
      return [c ? startX + (c.num - 1) * cell + cell / 2 : startX, headH + dy * cell + cell / 2];
    });
    const b1Pts = m.rows.map((row, i) => {
      const c = row.backCells.find((cc) => cc.hit && cc.num === row.back[1]);
      const dy = n - 1 - i;
      return [c ? startX + (c.num - 1) * cell + cell / 2 : startX, headH + dy * cell + cell / 2];
    });
    const d0 = b0Pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join(' ');
    const d1 = b1Pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join(' ');
    lineLayer = `<svg class="mx2-line" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">
      <path d="${d0}" stroke="#1c6ceb" stroke-width="${Math.max(1.8, cell / 16)}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.55" />
      <path d="${d1}" stroke="#1565c0" stroke-width="${Math.max(1.6, cell / 18)}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${cell/4} ${cell/8}" stroke-opacity="0.5" />
    </svg>`;
  }

  const fRed = m.headers.front.map((h) => `<th class="mx2-th z${h.zone}">${h.label}</th>`).join('');
  const fBlue = m.headers.back.map((h) => `<th class="mx2-th">${h.label}</th>`).join('');
  const groupHead = (label, span) => `<th colspan="${span}" class="grp-h">${label}</th>`;
  const derivsH = '<th class="deriv-h">和值</th><th class="deriv-h">跨度</th><th class="deriv-h">区间比</th><th class="deriv-h">奇偶比</th>';

  $('#trendBox').innerHTML = `
    <div style="display:flex;gap:6px;margin-bottom:10px;align-items:center">
      <span class="hint" style="margin:0;font-size:11px">期数</span>
      <div class="seg" id="mxPresets" style="margin:0;flex:1">
        <button data-n="50" class="${mxN === 50 ? 'on' : ''}">50期</button>
        <button data-n="80" class="${mxN === 80 ? 'on' : ''}">80期</button>
        <button data-n="120" class="${mxN === 120 ? 'on' : ''}">120期</button>
        <button data-n="300" class="${mxN === 300 ? 'on' : ''}">300期</button>
        <button data-n="500" class="${mxN === 500 ? 'on' : ''}">500期</button>
      </div>
      <button class="btn ghost" id="mxZoomOut" style="font-size:14px;padding:6px 10px">A-</button>
      <button class="btn ghost" id="mxZoomIn" style="font-size:14px;padding:6px 10px">A+</button>
    </div>
    <div class="mx-wrap" style="position:relative">
      <table class="mx2-table">
        <thead>
          <tr>${groupHead('期号', 1)}${showFront ? groupHead('一区 01-07', 7) + groupHead('二区 08-14', 7) + groupHead('三区 15-21', 7) + groupHead('四区 22-28', 7) + groupHead('五区 29-35', 7) : ''}${showBack ? groupHead('后区 01-12', 12) : ''}${mxTab === 'basic' ? groupHead('派生指标', 4) : ''}</tr>
          <tr>${'<th class="mx-issue-h">期号</th>'}${showFront ? fRed : ''}${'<th class="mx-sep"></th>'}${showBack ? fBlue : ''}${mxTab === 'basic' ? derivsH : ''}</tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr class="mx-foot-labels">
            <th class="mx-issue-h">↓ 列号</th>
            ${m.headers.front.map((h) => `<th class="mx2-th z${h.zone}">${h.label}</th>`).join('')}
            <th class="mx-sep"></th>
            ${m.headers.back.map((h) => `<th class="mx2-th">${h.label}</th>`).join('')}
            ${mxTab === 'basic' ? '<th class="deriv-h" colspan="4">和值/跨度/区间比/奇偶比</th>' : ''}
          </tr>
        </tfoot>
      </table>
      ${lineLayer}
    </div>
    <div class="mx-legend">
      <span><i class="mx2-ball r"></i>本期前区</span>
      <span><i class="mx2-ball b"></i>本期后区</span>
      <span>实线=后区第1位 · 虚线=后区第2位</span>
      <span style="margin-left:auto">数字=截至上期连续未出期数(0=上期出过)</span>
    </div>
  `;
  if (showBack) {
    requestAnimationFrame(() => {
      if (!alignLine()) [30, 120, 300, 600, 1000].forEach((d) => setTimeout(alignLine, d));
    });
    const wrapEl = document.querySelector('#trendBox .mx-wrap');
    if (wrapEl && 'ResizeObserver' in window) {
      const ro = new ResizeObserver(() => alignLine());
      ro.observe(wrapEl);
      setTimeout(() => ro.disconnect(), 60000);
    }
  }
  $('#mxPresets').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    mxN = +b.dataset.n;
    $('#mxPresets').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderNumberList(draws);
  });
  const applyZoom = (z) => {
    document.documentElement.style.setProperty('--mx-cell', (32 * z) + 'px');
    document.documentElement.style.setProperty('--mx-font', (11 * z) + 'px');
    document.documentElement.style.setProperty('--mx-ball', (15 * z) + 'px');
    document.documentElement.style.setProperty('--mx-ballfont', (8.5 * z) + 'px');
  };
  let mxZoomLive = +(localStorage.getItem('dltMxZoom') || 1);
  applyZoom(mxZoomLive);
  const preserveScroll = (newZ) => {
    const w = document.querySelector('#trendBox .mx-wrap');
    const sl = w ? w.scrollLeft : 0, st = w ? w.scrollTop : 0;
    applyZoom(newZ);
    renderNumberList(draws);
    requestAnimationFrame(() => {
      const w2 = document.querySelector('#trendBox .mx-wrap');
      if (w2) { w2.scrollLeft = sl; w2.scrollTop = st; }
    });
  };
  $('#mxZoomIn').onclick = () => { mxZoomLive = Math.min(1.8, +(mxZoomLive + 0.15).toFixed(2)); preserveScroll(mxZoomLive); localStorage.setItem('dltMxZoom', mxZoomLive); };
  $('#mxZoomOut').onclick = () => { mxZoomLive = Math.max(0.6, +(mxZoomLive - 0.15).toFixed(2)); preserveScroll(mxZoomLive); localStorage.setItem('dltMxZoom', mxZoomLive); };
}

function cellBg(miss) {
  if (miss === 0) return '#fff5f6';
  if (miss < 5) return '#fff0e0';
  if (miss < 10) return '#ffe5d6';
  if (miss < 20) return '#ffdbdb';
  if (miss < 40) return '#f0c0c8';
  return '#d9959f';
}

function alignLine() {
  const svg = document.querySelector('#trendBox svg.mx2-line');
  const tbl = document.querySelector('#trendBox .mx2-table');
  const wrap = document.querySelector('#trendBox .mx-wrap');
  if (!svg || !tbl || !wrap) return false;
  const pageTrend = document.getElementById('page-trend');
  if (pageTrend && !pageTrend.classList.contains('active')) return false;
  const tblRect = tbl.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  if (tblRect.width < 50 || tblRect.height < 50) return false;
  const ox = tblRect.left - wrapRect.left, oy = tblRect.top - wrapRect.top;
  const w = tblRect.width, h = tblRect.height;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.style.left = ox + 'px';
  svg.style.top = oy + 'px';
  // 收集每行 hit 后区 td：每行有 2 个（back[0], back[1]），按 back[0]/back[1] 拆到两条 path
  const back0pts = [], back1pts = [];
  tbl.querySelectorAll('tbody tr').forEach((tr) => {
    const hits = tr.querySelectorAll('td.mx2-cell.hit:has(span.mx2-ball.b)');
    hits.forEach((td, idx) => {
      const tdr = td.getBoundingClientRect();
      const x = tdr.left - wrapRect.left - ox + tdr.width / 2;
      const y = tdr.top - wrapRect.top - oy + tdr.height / 2;
      if (idx === 0) back0pts.push([x, y]);
      else if (idx === 1) back1pts.push([x, y]);
    });
  });
  const paths = svg.querySelectorAll('path');
  if (paths.length >= 2) {
    if (back0pts.length) paths[0].setAttribute('d', back0pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '));
    if (back1pts.length) paths[1].setAttribute('d', back1pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '));
  }
  return true;
}

// ===== 路由 =====
function switchPage(p) {
  curPage = p;
  document.querySelectorAll('.page').forEach((s) => s.classList.toggle('active', s.id === 'page-' + p));
  document.querySelectorAll('nav button[data-page]').forEach((b) => b.classList.toggle('on', b.dataset.page === p));
  if (location.hash !== '#' + p) history.replaceState(null, '', '#' + p);
  window.scrollTo({ top: 0 });
  const h = document.querySelector('header'); if (h) h.classList.remove('collapsed');
}
(function () {
  let ticking = false;
  const update = () => {
    ticking = false;
    const h = document.querySelector('header');
    if (!h) return;
    const y = window.scrollY || document.documentElement.scrollTop;
    h.classList.toggle('collapsed', y > 50);
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });
})();
document.querySelectorAll('nav button[data-page]').forEach((b) => b.onclick = () => switchPage(b.dataset.page));
if (location.hash) {
  const p = location.hash.slice(1);
  if (['home', 'query', 'stats', 'trend'].includes(p)) switchPage(p);
}

// ===== 自动更新（大乐透：周一/三/六 21:25 之后） =====
function isDrawDay(d) { return d.getDay() === 1 || d.getDay() === 3 || d.getDay() === 6; }
function isDrawWindow(d) {
  if (!isDrawDay(d)) return false;
  return d.getHours() > 21 || (d.getHours() === 21 && d.getMinutes() >= 25);
}
let lastRefresh = 0;
async function autoTick() {
  const now = new Date();
  if (!isDrawWindow(now)) return;
  if (Date.now() - lastRefresh < 30 * 60 * 1000) return;
  lastRefresh = Date.now();
  toast('新一期可能已开奖，点击刷新 ⟳ 获取最新数据');
}
setInterval(autoTick, 60 * 1000);
setTimeout(autoTick, 8000);

$('#refreshBtn').onclick = async () => {
  toast('正在刷新数据…');
  try {
    const r = await fetch('/api/draws?lotto=dlt&t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); if (j.ok && j.draws && j.draws.length > 100) { DRAWS = j.draws; DATA_SRC = j.source; if (j.latestMeta) LATEST_META = j.latestMeta; renderAll(); toast('已更新到最新数据'); return; } }
  } catch (e) {}
  const s = document.createElement('script'); s.src = 'snapshot.js?t=' + Date.now();
  s.onerror = () => toast('刷新失败，请稍后重试');
  s.onload = () => { if (window.__SNAPSHOT__ && window.__SNAPSHOT__.draws) { DRAWS = window.__SNAPSHOT__.draws; DATA_SRC = '内置快照'; renderAll(); toast('已更新到最新快照'); } };
  document.head.appendChild(s);
};

// ===== PWA install =====
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
const installBtn = document.getElementById('installBtn');
if (installBtn) {
  installBtn.onclick = async () => {
    if (deferredPrompt) { deferredPrompt.prompt(); const { outcome } = await deferredPrompt.userChoice; if (outcome === 'accepted') toast('已添加到桌面'); deferredPrompt = null; }
    else { document.getElementById('installModal').style.display = 'flex'; }
  };
}
const closeModal = document.getElementById('closeModal');
if (closeModal) closeModal.onclick = () => { document.getElementById('installModal').style.display = 'none'; };

// ===== 启动 =====
loadData().catch((e) => {
  console.error('数据加载失败', e);
  $('#latestBox').innerHTML = '<div class="loading">数据加载失败，请刷新页面</div>';
  $('#srcInfo').textContent = '数据加载失败';
});

// Service Worker：注册新版本 + 启动时清掉老缓存
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW 注册失败', e));
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => { if (r.active && r.active.scriptURL && !r.active.scriptURL.endsWith('sw.js')) r.unregister().catch(() => {}); });
  });
  if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
}
