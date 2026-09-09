/* 双色球统计工作台 - 前端逻辑 */
'use strict';
let DRAWS = [];          // 升序 [{issue,date,reds,blue}]
let DATA_SRC = '';
let LATEST_META = null;   // 最新一期官方详情：销量/奖池/一等奖分布/奖等明细
let curPage = 'home';
let pageSize = 50, shown = 0, searchQ = '';
let selNums = new Set(), queryMode = 'include', lastResult = null, resTab = 'hits';
let statsRange = 0, trendType = 'basic', trendView = 'matrix', matrixN = 30, mxTab = 'basic', mxN = 50;

const $ = (s) => document.querySelector(s);
const pad = (n) => (n < 10 ? '0' + n : '' + n);
const pad2 = pad;
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); }
function ballsHtml(reds, blue, cls) {
  return reds.map((r) => `<span class="ball r ${cls}">${pad(r)}</span>`).join('')
    + `<span class="ball b ${cls}">${pad(blue)}</span>`;
}

// ===== 数据加载：/api/draws → 内置快照 =====
async function loadData(force) {
  $('#srcInfo').textContent = '数据加载中…';
  let ok = false;
  try {
    const r = await fetch('/api/draws?lotto=ssq' + (force ? '&t=' + Date.now() : ''), { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (j.ok && j.draws && j.draws.length > 1000) {
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
    } else throw new Error('无可用数据');
  }
  $('#srcInfo').textContent = `${DRAWS.length}期 · ${DRAWS[0].issue.slice(0,4)}-${DRAWS[DRAWS.length-1].issue.slice(0,4)} · ${DATA_SRC} · v${window.SSQ_VERSION || '?'}`;
  renderAll();
  // 异步加载最新一期详情（销量/奖池/一等奖分布/奖等明细）
  loadLatestMeta().catch((e) => console.warn('latest meta 加载失败:', e.message));
}

async function loadLatestMeta() {
  try {
    const r = await fetch('/api/latest?lotto=ssq', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (j.ok && j.meta) {
        LATEST_META = j.meta;
        if (curPage === 'home') renderLatest();
      }
    }
  } catch (e) { /* 静态版无 API 时静默 */ }
}

function renderAll() {
  renderLatest(); resetList(); renderPickArea(); renderSelInfo();
  renderStats(); renderTrend();
  if (lastResult) renderQueryResult();
}// ===== 首页 =====
function renderLatest() {
  if (!DRAWS.length) return;
  const d = DRAWS[DRAWS.length - 1];
  const S = SSQStats;
  const meta = [
    `和值 ${S.sumOf(d)}`, `单双 ${S.oddEvenOf(d)}`, `大小 ${S.bigSmallOf(d)}`,
    `跨度 ${S.spanOf(d)}`, `一区${S.zoneCounts(d)[0]} 二区${S.zoneCounts(d)[1]} 三区${S.zoneCounts(d)[2]}`,
    S.consecOf(d).length ? `连号 ${S.consecOf(d).map((g) => g.join(',')).join(' / ')}` : '无连号',
  ];
  const m = LATEST_META;
  const money = (n) => n >= 1e8 ? (n / 1e8).toFixed(2) + '亿' : n >= 1e4 ? (n / 1e4).toFixed(0) + '万' : n;
  const prizeNames = ['', '一等奖', '二等奖', '三等奖', '四等奖', '五等奖', '六等奖', '七等奖'];
  let prizeRows = '';
  if (m && m.prizes && m.prizes.length) {
    prizeRows = m.prizes.filter((p) => p.num > 0).map((p) => `
      <div class="prizeRow"><span class="pn">${prizeNames[p.type] || '奖' + p.type}</span>
      <span class="pc">${p.num.toLocaleString()} 注</span>
      <span class="pm">¥${money(p.money)}</span></div>`).join('');
  }
  const officialBlock = m ? `
    <div class="officialBox">
      <div class="ob-title">📊 全国中奖情况（来源：中国福彩网）</div>
      <div class="ob-stats">
        <div><div class="ol">本期销量</div><div class="ov">¥${money(m.sales)}</div></div>
        <div><div class="ol">奖池滚存</div><div class="ov">¥${money(m.poolmoney)}</div></div>
        <div><div class="ol">一等奖</div><div class="ov">${m.prizes[0]?.num || 0} 注</div></div>
      </div>
      ${m.content ? `<div class="ob-region"><b>一等奖地区分布：</b>${esc(m.content)}</div>` : ''}
      ${prizeRows ? `<div class="ob-prizes">${prizeRows}</div>` : ''}
    </div>` : '<div class="officialBox"><div class="ob-title">全国中奖详情加载中…</div></div>';
  $('#latestBox').innerHTML = `
  <div class="latest">
    <div class="row1">
      <span class="issue">${d.issue}</span><span class="date">${d.date}</span>
      <span class="tag">最新一期</span>
    </div>
    <div class="balls">${ballsHtml(d.reds, d.blue, 'lg')}</div>
    <div class="meta">${meta.map((m) => `<span>${m}</span>`).join('')}</div>
    <div class="meta"><span>蓝球 ${pad(d.blue)} → ${SSQStats.groupOfBlue(d.blue)}组（${SSQStats.BLUE_GROUPS[SSQStats.groupOfBlue(d.blue)].join(' / ')}）</span></div>
    ${officialBlock}
  </div>`;
}

function drawRows() {
  const q = searchQ.trim().replace(/^20/, '');
  const rows = [];
  for (let i = DRAWS.length - 1; i >= 0; i--) {
    const d = DRAWS[i];
    if (q && !d.issue.endsWith(q) && !d.issue.endsWith(q.padStart(5, '0')) && d.issue !== searchQ.trim()) continue;
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
      <div class="nums">${ballsHtml(d.reds, d.blue, 'sm')}</div>
    </div>`).join('');
  $('#moreBtn').style.display = shown < rows.length ? 'block' : 'none';
  $('#moreBtn').textContent = `加载更多（剩余 ${rows.length - shown} 期）`;
}
$('#moreBtn').onclick = () => { shown += pageSize; renderList(); };
$('#searchInput').oninput = (e) => { searchQ = e.target.value; shown = pageSize; renderList(); };
$('#clearSearch').onclick = () => { $('#searchInput').value = ''; searchQ = ''; resetList(); };

// ===== 查询页 =====
function renderPickArea() {
  const box = $('#pickArea');
  box.innerHTML = '';
  const zones = [['z0', '一区 01-11', 1, 11], ['z1', '二区 12-22', 12, 22], ['z2', '三区 23-33', 23, 33]];
  zones.forEach(([cls, lbl, lo, hi]) => {
    box.appendChild(el('div', 'zoneLbl', `<i style="background:var(--${cls === 'z0' ? 'red' : cls === 'z1' ? 'warn' : 'accent'})"></i>${lbl}`));
    const g = el('div', 'pickGrid');
    for (let n = lo; n <= hi; n++) {
      const b = el('button', 'pick ' + cls + (selNums.has(n) ? ' on' : ''), pad(n));
      b.onclick = () => { selNums.has(n) ? selNums.delete(n) : selNums.add(n); b.classList.toggle('on'); renderSelInfo(); };
      g.appendChild(b);
    }
    box.appendChild(g);
  });
}
function renderSelInfo() {
  const arr = [...selNums].sort((a, b) => a - b);
  $('#selInfo').textContent = arr.length ? `已选 ${arr.length} 个：` + arr.map(pad).join(' ') : '未选号';
  $('#queryBtn').disabled = !arr.length;
  // 预选行按钮
  [1, 2, 3].forEach((i) => {
    const lab = $('#preset-' + i + '-lab');
    const btn = $('#preset-' + i);
    const saved = JSON.parse(localStorage.getItem('ssqPreset' + i) || '[]');
    if (lab) lab.textContent = saved.length ? '预选行' + i + '：' + saved.map(pad).join(' ') : '预选行' + i + '：空';
    if (btn) {
      // 简化逻辑：当前有选号 → 点击保存；当前无选号 + 预选行有号 → 点击加载
      if (arr.length) { btn.textContent = '↑ 保存到预选行' + i; btn.disabled = false; }
      else if (saved.length) { btn.textContent = '↓ 加载预选行' + i; btn.disabled = false; }
      else { btn.textContent = '· 预选行' + i; btn.disabled = true; }
    }
  });
}
function savePreset(i) {
  if (!selNums.size) { localStorage.removeItem('ssqPreset' + i); toast('预选行' + i + '已清空'); }
  else { localStorage.setItem('ssqPreset' + i, JSON.stringify([...selNums])); toast('预选行' + i + '已保存：' + [...selNums].sort((a, b) => a - b).map(pad).join(' ')); }
  renderSelInfo();
}
function loadPreset(i) {
  const saved = JSON.parse(localStorage.getItem('ssqPreset' + i) || '[]');
  if (!saved.length) { toast('预选行' + i + '为空'); return; }
  selNums = new Set(saved);
  renderPickArea(); renderSelInfo();
  toast('已加载预选行' + i + '：' + saved.map(pad).join(' '));
}
function presetBtnClick(i) {
  const arr = [...selNums];
  const saved = JSON.parse(localStorage.getItem('ssqPreset' + i) || '[]');
  if (arr.length) savePreset(i);
  else if (saved.length) loadPreset(i);
}
$('#clearPick').onclick = () => { selNums.clear(); renderPickArea(); renderSelInfo(); };
[1, 2, 3].forEach((i) => {
  document.addEventListener('click', (e) => { if (e.target && e.target.id === 'preset-' + i) presetBtnClick(i); });
});
$('#modeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  queryMode = b.dataset.mode;
  document.querySelectorAll('#modeSeg button').forEach((x) => x.classList.toggle('on', x === b));
  $('#modeDesc').innerHTML = queryMode === 'include'
    ? '包含模式：开奖红球<b>同时包含</b>所有勾选号码即可命中，例如勾 1、3 → 只要红球里有 1 也有 3 就算。'
    : '精确模式：勾选号所在分区<b>恰好只开出</b>所选号码（不多不少）。例如勾 1、3 → 一区出号必须恰好是 1、3 两个。可跨区组合。';
  $('#modeTip').textContent = queryMode === 'include' ? '红球包含所选全部号码' : '所选分区恰好开出所选号码';
  if (lastResult) doQuery();
});
$('#queryBtn').onclick = doQuery;
function doQuery() {
  const sel = [...selNums].sort((a, b) => a - b);
  if (!sel.length) return;
  lastResult = SSQStats.query(DRAWS, sel, queryMode);
  resTab = 'hits';
  renderQueryResult();
  $('#queryResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderQueryResult() {
  const r = lastResult, box = $('#queryResult');
  if (!r) { box.innerHTML = ''; return; }
  const modeName = r.mode === 'include' ? '包含' : '精确';
  const selTxt = r.sel.map(pad).join(' ');
  const pct = (r.count / DRAWS.length * 100).toFixed(2);
  let html = `
  <div class="card">
    <div class="resHead">
      <span class="big">${r.count}</span>
      <div class="desc"><b>${modeName}模式</b> · 勾选 ${selTxt}<br>
      历史命中 ${r.count} 期（占全部 ${DRAWS.length} 期的 ${pct}%）
      ${r.skippedNoNext ? `<br>其中 ${r.skippedNoNext} 期为最新一期、无下一期` : ''}</div>
    </div>
    <div class="subtabs">
      <button data-t="hits" class="${resTab === 'hits' ? 'on' : ''}">命中详情（${r.count}）</button>
      <button data-t="next" class="${resTab === 'next' ? 'on' : ''}">下一期分析（${r.nexts.length}）</button>
    </div>
    <div id="resBody"></div>
  </div>`;
  box.innerHTML = html;
  box.querySelectorAll('.subtabs button').forEach((b) => b.onclick = () => { resTab = b.dataset.t; renderQueryResult(); });
  const body = box.querySelector('#resBody');
  if (resTab === 'hits') renderHits(body, r);
  else renderNextStats(body, r);
}

function renderHits(body, r) {
  if (!r.count) { body.innerHTML = '<div class="loading">历史上没有满足条件的期</div>'; return; }
  const frag = document.createDocumentFragment();
  r.hits.slice().reverse().forEach((h, i) => {  // 新的在前
    const item = el('div', 'hitItem', `
      <div class="cur"><span class="idx">${h.issue}</span><span class="lbl">本期</span>
        <div class="nums">${ballsHtml(h.reds, h.blue, 'sm')}</div></div>
      ${h.next
        ? `<div class="nxt"><span class="idx">${h.next.issue}</span><span class="lbl">下一期</span>
           <div class="nums">${ballsHtml(h.next.reds, h.next.blue, 'sm')}</div></div>`
        : '<div class="nonext">这是最新一期，还没有下一期</div>'}`);
    frag.appendChild(item);
  });
  body.appendChild(frag);
}

function renderNextStats(body, r) {
  const ns = r.nextStats;
  if (!ns) { body.innerHTML = '<div class="loading">没有可分析的下一期</div>'; return; }
  const barRow = (k, v, max, unit) => `
    <div class="barRow"><div class="bk">${k}</div><div class="bar"><i style="width:${max ? (v / max * 100).toFixed(1) : 0}%"></i></div><div class="bv">${v}${unit || ''}</div></div>`;
  const maxG = Math.max(...Object.values(ns.groupDist));
  const groupColor = { A: 'var(--gA)', B: 'var(--gB)', C: 'var(--gC)', D: 'var(--gD)' };
  const html = [];
  html.push(`<h3 style="margin:4px 0 8px">开出${r.sel.map(pad).join('、')}的下一期 · 共 ${ns.total} 期样本</h3>`);
  // 蓝球组分布
  html.push(`<h3 style="margin:14px 0 4px">蓝球四组分布</h3><div class="legend">${'ABCD'.split('').map((g) => `<span><i style="background:${groupColor[g]}"></i>${g}组 ${SSQStats.BLUE_GROUPS[g].join(',')}</span>`).join('')}</div>`);
  Object.entries(ns.groupDist).forEach(([g, c]) => {
    html.push(`<div class="barRow"><div class="bk" style="color:${groupColor[g]};font-weight:700">${g}组</div><div class="bar"><i style="width:${(c / maxG * 100).toFixed(1)}%;background:${groupColor[g]}"></i></div><div class="bv">${c} 期 ${ (c / ns.total * 100).toFixed(1)}%</div></div>`);
  });
  // 核心数字
  html.push(`<div class="statGrid" style="margin-top:14px">
    <div class="statBox"><div class="v">${ns.avgSum}</div><div class="k">平均和值</div></div>
    <div class="statBox"><div class="v">${ns.consecRate}%</div><div class="k">连号出现率</div></div>
    <div class="statBox"><div class="v">${ns.repeatRate}%</div><div class="k">重号出现率</div></div>
    <div class="statBox"><div class="v">${ns.blueTop.length ? pad(ns.blueTop[0][0]) : '-'}</div><div class="k">最热蓝球</div></div>
  </div>`);
  // 红球高频
  if (ns.redTop.length) {
    const maxR = ns.redTop[0][1];
    html.push(`<h3 style="margin:14px 0 4px">下一期红球高频号 Top${ns.redTop.length}</h3>`);
    ns.redTop.forEach(([n, c]) => html.push(barRow(pad(n) + '号', c, maxR, ' 次')));
  }
  // 蓝球高频
  if (ns.blueTop.length) {
    const maxB = ns.blueTop[0][1];
    html.push(`<h3 style="margin:14px 0 4px">下一期蓝球高频号 Top${ns.blueTop.length}</h3>`);
    ns.blueTop.forEach(([n, c]) => html.push(barRow(pad(n) + '号', c, maxB, ' 次')));
  }
  // 各区出号
  html.push(`<h3 style="margin:14px 0 4px">下一期分区出号个数分布</h3>`);
  [['一区', ns.zoneDist['一区']], ['二区', ns.zoneDist['二区']], ['三区', ns.zoneDist['三区']]].forEach(([zn, dist]) => {
    const tot = dist.reduce((a, b) => a + b[1], 0);
    const avg = dist.reduce((a, b) => a + b[0] * b[1], 0) / tot;
    html.push(`<div class="hint" style="margin:6px 0 2px"><b>${zn}</b> 平均出 ${avg.toFixed(2)} 个：${dist.map(([k, v]) => `${k}个×${v}期`).join('，')}</div>`);
  });
  // 和值区间
  const maxS = Math.max(...ns.sumBuckets.map((x) => x[1]), 1);
  html.push(`<h3 style="margin:14px 0 4px">下一期和值区间分布</h3>`);
  ns.sumBuckets.forEach(([k, v]) => html.push(barRow(k, v, maxS, ' 期')));
  // 单双
  html.push(`<h3 style="margin:14px 0 4px">下一期单双比分布</h3>`);
  const maxOE = Math.max(...ns.oddEvenTop.map((x) => x[1]));
  ns.oddEvenTop.forEach(([k, v]) => html.push(barRow(k, v, maxOE, ' 期')));
  // 重号号码
  if (ns.repeatNumsTop.length) {
    const maxRp = ns.repeatNumsTop[0][1];
    html.push(`<h3 style="margin:14px 0 4px">下一期最常重开的号（与命中期的重号）</h3>`);
    ns.repeatNumsTop.forEach(([n, c]) => html.push(barRow(pad(n) + '号', c, maxRp, ' 次')));
  }
  body.innerHTML = html.join('');
}

// ===== 统计页 =====
function renderStats() {
  if (!DRAWS.length) return;
  const draws = statsRange ? DRAWS.slice(-statsRange) : DRAWS;
  $('#statsRangeLbl').textContent = `样本 ${draws.length} 期（${draws[0].issue} ~ ${draws[draws.length - 1].issue}）`;
  const bs = SSQStats.basicStats(draws);
  const barRow = (k, v, max, unit) => `
    <div class="barRow"><div class="bk">${k}</div><div class="bar"><i style="width:${max ? (v / max * 100).toFixed(1) : 0}%"></i></div><div class="bv">${v}${unit || ''}</div></div>`;
  const h = [];
  h.push(`<div class="statGrid">
    <div class="statBox"><div class="v">${bs.sum.avg}</div><div class="k">平均和值（中位 ${bs.sum.median}）</div></div>
    <div class="statBox"><div class="v">${bs.consec.rate}%</div><div class="k">连号出现率</div></div>
    <div class="statBox"><div class="v">${bs.repeat.rate}%</div><div class="k">重号出现率（均重${bs.repeat.avgNums}个）</div></div>
    <div class="statBox"><div class="v">${bs.sum.min}~${bs.sum.max}</div><div class="k">和值范围</div></div>
  </div>`);
  h.push(`<h3 style="margin:14px 0 4px">连号形态</h3>`);
  const cMax = Math.max(bs.consec.none[1], bs.consec.two[1], bs.consec.three[1], bs.consec.fourPlus[1]);
  h.push(barRow('无连号', bs.consec.none[1], cMax, '%'));
  h.push(barRow('二连号', bs.consec.two[1], cMax, '%'));
  h.push(barRow('三连号', bs.consec.three[1], cMax, '%'));
  h.push(barRow('四连及以上', bs.consec.fourPlus[1], cMax, '%'));
  h.push(`<h3 style="margin:14px 0 4px">单双比分布</h3>`);
  const oeMax = bs.oddEven[0][1];
  bs.oddEven.forEach(([k, v]) => h.push(barRow('单' + k, v, oeMax, ' 期')));
  h.push(`<h3 style="margin:14px 0 4px">大小比分布（1-17小 / 18-33大）</h3>`);
  const bsMax = bs.bigSmall[0][1];
  bs.bigSmall.forEach(([k, v]) => h.push(barRow('小' + k, v, bsMax, ' 期')));
  h.push(`<h3 style="margin:14px 0 4px">和值区间分布</h3>`);
  const sMax = Math.max(...bs.sum.buckets.map((x) => x[1]));
  bs.sum.buckets.forEach(([k, v]) => h.push(barRow(k, v, sMax, ' 期')));
  h.push(`<h3 style="margin:14px 0 4px">跨度分布（最大号-最小号）</h3>`);
  const spMax = Math.max(...bs.span.map((x) => x[1]));
  bs.span.forEach(([k, v]) => h.push(barRow(k + '', v, spMax, ' 期')));
  $('#statsBox').innerHTML = h.join('');
}
$('#rangeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  statsRange = +b.dataset.n;
  document.querySelectorAll('#rangeSeg button').forEach((x) => x.classList.toggle('on', x === b));
  renderStats();
});

// ===== 走势页 =====
function renderTrend() {
  if (!DRAWS.length) return;
  const draws = DRAWS;
  $('#trendRangeLbl').textContent = `全部 ${draws.length} 期 · 点右上“☰ 20种走势”切换更多`;
  // 默认直接渲染"基本走势"数字列表表格（红蓝半透明号码+遗漏数+底部表头列号），
  // 这是用户最常用的“第二张样式”，不再默认停在菜单网格。
  // 顶部“☰ 20种走势”按钮仍可随时进入全部走势菜单（不抛弃菜单功能）。
  // 按 trendType 决定渲染 basic / red / blue 数字列表。
  mxTab = trendType === 'red' ? 'red' : trendType === 'blue' ? 'blue' : 'basic';
  renderNumberList(draws);
}

// ===== 数字列表走势（核心新视图） =====
function renderNumberList(draws) {
  // 通用：所有非基本走势都走"子走势图"路径（数字列表骨架+自定义列）
  if (mxTab !== 'basic' && mxTab !== 'red' && mxTab !== 'blue' && mxTab !== 'tue' && mxTab !== 'thu' && mxTab !== 'sun') {
    renderSubTrend(draws);
    return;
  }
  const filter = mxTab === 'tue' ? { weekday: 2 } : mxTab === 'thu' ? { weekday: 4 } : mxTab === 'sun' ? { weekday: 0 } : null;
  const m = SSQStats.matrixNum(draws, mxN, filter);
  if (!m.sliceLen) { $('#trendBox').innerHTML = '<div class="loading">所选条件下没有数据</div>'; return; }
  const cellBg = (miss) => {
    if (miss === 0) return 'transparent';
    const t = Math.min(1, miss / 20);
    const r = Math.round(255 + (220 - 255) * t);
    const g = Math.round(245 + (200 - 245) * t);
    const b = Math.round(245 + (200 - 245) * t);
    return `rgb(${r},${g},${b})`;
  };
  // 展示顺序：最早在上、最新在底（时间轴向下）。
  // m.rows 是"最新在前"，每行对应 slice 下标 = sliceLen-1-ri。
  // 反转成"最早在前"，并记下每行真实 slice 下标用于蓝球遗漏计算。
  const display = m.rows.map((row, ri) => ({ row, sIdx: m.sliceLen - 1 - ri })).reverse();
  let rowsHtml = '';
  display.forEach(({ row, sIdx }) => {
    let html = `<th class="mx-issue">${row.issue.slice(-5)}<br><span class="mx-date">${row.date.slice(5)}</span></th>`;
    if (mxTab !== 'blue') {
      row.redCells.forEach((c) => {
        if (c.hit) html += `<td class="mx2-cell hit"><span class="mx2-ball r">${pad(c.num)}</span></td>`;
        else html += `<td class="mx2-cell" style="background:${cellBg(c.miss)}">${c.miss}</td>`;
      });
    } else { html += `<td colspan="33" class="mx2-blank"></td>`; }
    html += `<td class="mx2-sep"></td>`;
    if (mxTab !== 'red') {
      for (let n = 1; n <= 16; n++) {
        if (n === row.blueCell.num) html += `<td class="mx2-cell hit col-b${pad2(n)}"><span class="mx2-ball b">${pad(n)}</span></td>`;
        else {
          let miss = 0;
          for (let i = sIdx; i >= 0; i--) { if (draws[draws.length - m.sliceLen + i].blue === n) break; miss++; }
          html += `<td class="mx2-cell" style="background:${cellBg(miss)}">${miss}</td>`;
        }
      }
    } else { html += `<td colspan="16" class="mx2-blank"></td>`; }
    if (mxTab === 'basic' || mxTab === 'red' || mxTab === 'tue' || mxTab === 'thu' || mxTab === 'sun') {
      const oeCls = (row.derivs.oddEven === '3:3' || row.derivs.oddEven === '2:4' || row.derivs.oddEven === '4:2') ? 'oe-balanced' : ((row.derivs.oddEven === '1:5' || row.derivs.oddEven === '5:1') ? 'oe-imbal' : '');
      const zCls = (row.derivs.zones === '2:2:2' || row.derivs.zones === '1:3:2' || row.derivs.zones === '2:3:1') ? 'z-balanced' : ((row.derivs.zones === '0:3:3' || row.derivs.zones === '3:3:0') ? 'z-imbal' : '');
      html += `<td class="deriv-c">${row.derivs.sum}</td><td class="deriv-c">${row.derivs.span}</td><td class="deriv-c ${zCls}">${row.derivs.zones}</td><td class="deriv-c ${oeCls}">${row.derivs.oddEven}</td>`;
    } else { html += `<td colspan="4" class="mx2-blank"></td>`; }
    rowsHtml += `<tr>${html}</tr>`;
  });
  let lineLayer = '';
  if (mxTab === 'basic' || mxTab === 'blue') {
    // SVG 视口坐标 = 表格实际像素尺寸：1:1 对齐到蓝球格中心，跟随 A+/A- 缩放一致变形。
    const cell = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mx-cell')) || 32;
    const issueW = 56; // 期号列 min-width（与 .mx2-table thead th.mx-issue-h 一致）
    const sepW = 2;    // mx-sep 间隙列宽
    const headH = 24 + cell; // thead 两行：grp-h(24) + mx2-th(cell)
    // 列索引: 0=期号 1..33=红球 34=sep 35..50=蓝球 51..54=派生
    const blueColStart = 1 + 33 + 1; // = 35（蓝球 01 所在列的左边界 x 索引）
    const n = m.rows.length;
    // viewBox 用整张表的全宽+全高：与 .mx-wrap 1:1 渲染，不需 preserveAspectRatio
    // 高 = thead + tbody + tfoot（含 1px 边）
    const w = issueW + (1 + 33 + sepW + 16 + 4) * cell;
    const h = headH + n * cell + cell + 1;
    const startX = issueW + blueColStart * cell; // 蓝球 01 列中心
    // display 顺序：最新在底（m.rows 是 reverse，display 也是 reverse；dy=0..n-1 递增向下）
    const points = m.rows.map((row, i) => {
      const dy = n - 1 - i;
      return [
        startX + (row.blueCell.num - 1) * cell + cell / 2,
        headH + dy * cell + cell / 2,
      ];
    });
    const pathD = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]).join(' ');
    lineLayer = `<svg class="mx2-line" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">
      <path d="${pathD}" stroke="#1c6ceb" stroke-width="${Math.max(1.8, cell / 16)}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.5" />
    </svg>`;
  }
  const hRed = m.headers.red.map((h) => `<th class="mx2-th">${h.label}</th>`).join('');
  const hBlue = m.headers.blue.map((h) => `<th class="mx2-th g${h.group}">${h.label}</th>`).join('');
  const groupHead = (label, span) => `<th colspan="${span}" class="grp-h">${label}</th>`;
  const derivsH = '<th class="deriv-h">和值</th><th class="deriv-h">跨度</th><th class="deriv-h">区间比</th><th class="deriv-h">奇偶比</th>';
  $('#trendBox').innerHTML = `
    <div style="display:flex;gap:6px;margin-bottom:10px">
      <button class="btn ghost" id="goMenu" style="flex:1;font-size:12px;padding:8px">☰ 20种走势</button>
      <button class="btn ghost" id="goBlue" style="flex:1;font-size:12px;padding:8px">蓝球四分组</button>
      <button class="btn ghost" id="goQuery" style="flex:1;font-size:12px;padding:8px">条件查询</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:10px;align-items:center">
      <span class="hint" style="margin:0;font-size:11px">字号</span>
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
          <tr>${groupHead('期号', 1)}${groupHead('一区 01-11', 11)}${groupHead('二区 12-22', 11)}${groupHead('三区 23-33', 11)}${groupHead('蓝球', 16)}${groupHead('派生指标', 4)}</tr>
          <tr>${'<th class="mx-issue-h">期号</th>'}${hRed}${'<th class="mx-sep"></th>'}${hBlue}${(mxTab === 'basic' || mxTab === 'red' || mxTab === 'tue' || mxTab === 'thu' || mxTab === 'sun') ? derivsH : '<th class="deriv-h" colspan="4">派生指标</th>'}</tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr class="mx-foot-labels">
            <th class="mx-issue-h">↓ 列号</th>
            ${m.headers.red.map((h) => `<th class="mx2-th">${h.label}</th>`).join('')}
            <th class="mx-sep"></th>
            ${m.headers.blue.map((h) => `<th class="mx2-th g${h.group}">${h.label}</th>`).join('')}
            <th class="deriv-h" colspan="4">和值/跨度/区间比/奇偶比</th>
          </tr>
        </tfoot>
      </table>
      ${lineLayer}
    </div>
    <div class="mx-legend">
      <span><i class="mx2-ball r"></i>本期红球</span>
      <span><i class="mx2-ball b"></i>本期蓝球</span>
      <span>数字=截至上期连续未出期数(0=上期出过)</span>
    </div>
  `;
    // 折线 SVG 二次校准：把 viewBox/width/height 调到与表格实际像素一致，path 端点精确落在蓝球格中心
    if (mxTab === 'basic' || mxTab === 'blue') {
    const alignLine = () => {
      const svg = document.querySelector('#trendBox svg.mx2-line');
      const tbl = document.querySelector('#trendBox .mx2-table');
      const wrap = document.querySelector('#trendBox .mx-wrap');
      if (!svg || !tbl || !wrap) return false;
      const pageTrend = document.getElementById('page-trend');
      if (pageTrend && !pageTrend.classList.contains('active')) return false;
      const tblRect = tbl.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      if (tblRect.width < 50 || tblRect.height < 50) return false;
      const ox = tblRect.left - wrapRect.left;
      const oy = tblRect.top - wrapRect.top;
      const w = tblRect.width, h = tblRect.height;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.setAttribute('width', w);
      svg.setAttribute('height', h);
      svg.style.left = ox + 'px';
      svg.style.top = oy + 'px';
      // 用每个 hit 蓝球 td 的中心坐标作为 path 端点（tbody 顺序 = display 顺序，最新在末行）
      const blues = tbl.querySelectorAll('tbody tr td.mx2-cell.hit:has(span.mx2-ball.b)');
      const pts = [];
      blues.forEach((td) => {
        const tdr = td.getBoundingClientRect();
        pts.push([tdr.left - wrapRect.left - ox + tdr.width / 2, tdr.top - wrapRect.top - oy + tdr.height / 2]);
      });
      const path = svg.querySelector('path');
      if (path && pts.length) path.setAttribute('d', pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '));
      return true;
    };
    // 第一次：rAF 后
    requestAnimationFrame(() => {
      if (!alignLine()) {
        // trend 页可能还是 hidden，30/120/300/600/1000ms 后重试几次
        [30, 120, 300, 600, 1000].forEach((d) => setTimeout(alignLine, d));
      }
    });
    // 字号变化、横竖屏切换时重测：监听 wrap 尺寸变化
    const wrapEl = document.querySelector('#trendBox .mx-wrap');
    if (wrapEl && 'ResizeObserver' in window) {
      const ro = new ResizeObserver(() => alignLine());
      ro.observe(wrapEl);
      setTimeout(() => ro.disconnect(), 60000); // 60s 后停止观察（避免内存泄漏）
    }
  }
  $('#mxPresets').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    mxN = +b.dataset.n;
    $('#mxPresets').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderNumberList(draws);
  });
  $('#goMenu').onclick = () => renderTrendMenu();
  $('#goBlue').onclick = () => renderBlueTrend(draws);
  $('#goQuery').onclick = () => switchPage('query');
  // 字号缩放（共用 applyZoom 函数）—— 缩放会重渲染数字列表以让 SVG 视口与表格同步
  const applyZoom = (z) => {
    document.documentElement.style.setProperty('--mx-cell', (32 * z) + 'px');
    document.documentElement.style.setProperty('--mx-font', (11 * z) + 'px');
    document.documentElement.style.setProperty('--mx-ball', (15 * z) + 'px');
    document.documentElement.style.setProperty('--mx-ballfont', (8.5 * z) + 'px');
  };
  const mxZoomSaved = +(localStorage.getItem('ssqMxZoom') || 1);
  applyZoom(mxZoomSaved);
  let mxZoomLive = mxZoomSaved;
  // 缩放后需要保持当前横向滚动位置（用户对比列号时不能跳回最左）
  const preserveScrollAndZoom = (newZ) => {
    const w = document.querySelector('#trendBox .mx-wrap');
    const sl = w ? w.scrollLeft : 0, st = w ? w.scrollTop : 0;
    applyZoom(newZ);
    renderNumberList(draws);
    requestAnimationFrame(() => {
      const w2 = document.querySelector('#trendBox .mx-wrap');
      if (w2) { w2.scrollLeft = sl; w2.scrollTop = st; }
    });
  };
  $('#mxZoomIn').onclick = () => { mxZoomLive = Math.min(1.8, +(mxZoomLive + 0.15).toFixed(2)); preserveScrollAndZoom(mxZoomLive); localStorage.setItem('ssqMxZoom', mxZoomLive); };
  $('#mxZoomOut').onclick = () => { mxZoomLive = Math.max(0.6, +(mxZoomLive - 0.15).toFixed(2)); preserveScrollAndZoom(mxZoomLive); localStorage.setItem('ssqMxZoom', mxZoomLive); };
}

// ===== 20个走势图菜单（贴你参考图） =====
function renderTrendMenu() {
  const items = [
    { k: 'basic', n: '基本走势', d: '红+蓝+4项派生指标' },
    { k: 'red', n: '红球走势', d: '33红球连续遗漏' },
    { k: 'blue', n: '蓝球走势', d: '16蓝球遗漏+折线' },
    { k: 'consec', n: '连号走势', d: '每期连号形态' },
    { k: 'repeat', n: '重号走势', d: '与上期重复号码' },
    { k: 'tue', n: '周二走势', d: '周二开奖纵向对比' },
    { k: 'thu', n: '周四走势', d: '周四开奖纵向对比' },
    { k: 'sun', n: '周日走势', d: '周日开奖纵向对比' },
    { k: 'bsize', n: '红球大小', d: '1-17小 vs 18-33大' },
    { k: 'boe', n: '红球奇偶', d: '奇数偶数出号个数' },
    { k: 'bzh', n: '红球质合', d: '质数合数出号个数' },
    { k: 'b012', n: '红012路', d: '除3余0/1/2' },
    { k: 'sum', n: '和值走势', d: '红球6个之和' },
    { k: 'ac', n: 'AC值走势', d: '号码复杂程度' },
    { k: 'zone', n: '区间走势', d: '一/二/三区出号个数' },
    { k: 'span', n: '跨度走势', d: '最大号-最小号' },
    { k: 'tail', n: '尾数分布', d: '0-9尾数出号个数' },
    { k: 'sumt', n: '和尾走势', d: '和值的尾数' },
    { k: 'rmiss', n: '红球遗漏', d: '33号当前遗漏' },
    { k: 'bmiss', n: '蓝球遗漏', d: '16号当前遗漏' },
    { k: 'summ', n: '和值遗漏', d: '和值区间遗漏' },
  ];
  $('#trendBox').innerHTML = `
    <div class="trend-grid">
      ${items.map((it) => `<div class="trend-tile" data-k="${it.k}">
        <div class="tn">${it.n}</div><div class="td">${it.d}</div><div class="tarr">›</div>
      </div>`).join('')}
    </div>
    <p class="hint" style="text-align:center;margin-top:14px">点击任一项目进入对应走势图</p>
  `;
  $('#trendBox').querySelectorAll('.trend-tile').forEach((tile) => {
    tile.onclick = () => { mxTab = tile.dataset.k; renderNumberList(DRAWS); window.scrollTo({ top: 0 }); };
  });
}

// ===== 子走势图（非基本走势） =====
function renderSubTrend(draws) {
  const filter = mxTab === 'tue' ? { weekday: 2 } : mxTab === 'thu' ? { weekday: 4 } : mxTab === 'sun' ? { weekday: 0 } : null;
  const m = SSQStats.matrixNum(draws, mxN, filter);
  if (!m.sliceLen) { $('#trendBox').innerHTML = '<div class="loading">所选条件下没有数据</div>'; return; }
  const cellBg = (miss) => {
    const t = Math.min(1, miss / 20);
    const r = Math.round(255 + (220 - 255) * t);
    const g = Math.round(245 + (200 - 245) * t);
    const b = Math.round(245 + (200 - 245) * t);
    return `rgb(${r},${g},${b})`;
  };

  // 每种走势的列生成器
  const cols = {
    consec: () => {
      // 单列：连号组
      const th = '<th class="deriv-h" style="min-width:160px">连号</th>';
      const cells = (row) => {
        const cs = row.derivs.consec;
        const isHit = cs !== '—';
        return `<td class="deriv-c ${isHit ? 'oe-balanced' : ''}">${cs}</td>`;
      };
      return { th, cells, headRow: '<th class="mx-issue-h">期号</th>' };
    },
    repeat: () => {
      const th = '<th class="deriv-h" style="min-width:120px">与上期重号</th>';
      const cells = (row) => {
        const r = row.derivs.repeats;
        return `<td class="deriv-c ${r !== '—' ? 'oe-balanced' : ''}">${r}</td>`;
      };
      return { th, cells, headRow: '<th class="mx-issue-h">期号</th>' };
    },
    bsize: () => {
      // 6 个红球：标记大小 1-17小/18-33大
      const head = () => Array.from({ length: 33 }, (_, i) => `<th class="mx2-th ${i < 11 ? 'bsize-s' : 'bsize-b'}">${pad2(i + 1)}</th>`).join('');
      return { kind: 'cells', head: head(), cells: (row) => row.redCells.map((c) => {
        const cls = c.hit ? (c.num <= 17 ? 'mx2-cell hit bsize-s' : 'mx2-cell hit bsize-b') : 'mx2-cell';
        return c.hit ? `<td class="${cls}"><span class="mx2-ball r"></span></td>` : `<td class="mx2-cell" style="background:${cellBg(c.miss)};color:#d4c2a8">${c.miss <= 17 ? '小' : '大'}</td>`;
      }).join(''), headRow: '<th class="mx-issue-h">期号</th>' };
    },
    boe: () => {
      const head = () => Array.from({ length: 33 }, (_, i) => `<th class="mx2-th ${(i + 1) % 2 === 1 ? 'boe-o' : 'boe-e'}">${pad2(i + 1)}</th>`).join('');
      return { kind: 'cells', head: head(), cells: (row) => row.redCells.map((c) => {
        if (c.hit) return `<td class="mx2-cell hit"><span class="mx2-ball r"></span></td>`;
        return `<td class="mx2-cell" style="background:${cellBg(c.miss)};color:#9aa8c0">${(c.num % 2 === 1) ? '奇' : '偶'}</td>`;
      }).join(''), headRow: '<th class="mx-issue-h">期号</th>' };
    },
    bzh: () => {
      const isPrime = (n) => { if (n < 2) return false; for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
      const head = () => Array.from({ length: 33 }, (_, i) => `<th class="mx2-th">${pad2(i + 1)}</th>`).join('');
      return { kind: 'cells', head: head(), cells: (row) => row.redCells.map((c) => {
        if (c.hit) return `<td class="mx2-cell hit"><span class="mx2-ball r"></span></td>`;
        return `<td class="mx2-cell" style="background:${cellBg(c.miss)};color:#9aa8c0">${isPrime(c.num) ? '质' : '合'}</td>`;
      }).join(''), headRow: '<th class="mx-issue-h">期号</th>' };
    },
    b012: () => {
      const head = () => Array.from({ length: 33 }, (_, i) => `<th class="mx2-th">${pad2(i + 1)}</th>`).join('');
      return { kind: 'cells', head: head(), cells: (row) => row.redCells.map((c) => {
        if (c.hit) return `<td class="mx2-cell hit"><span class="mx2-ball r"></span></td>`;
        return `<td class="mx2-cell" style="background:${cellBg(c.miss)};color:#9aa8c0">${c.num % 3}</td>`;
      }).join(''), headRow: '<th class="mx-issue-h">期号</th>' };
    },
    sum: () => ({ kind: 'single', th: '<th class="deriv-h">和值</th>', cells: (row) => `<td class="deriv-c">${row.derivs.sum}</td>`, headRow: '<th class="mx-issue-h">期号</th>' }),
    span: () => ({ kind: 'single', th: '<th class="deriv-h">跨度</th>', cells: (row) => `<td class="deriv-c">${row.derivs.span}</td>`, headRow: '<th class="mx-issue-h">期号</th>' }),
    sumt: () => ({ kind: 'single', th: '<th class="deriv-h">和尾</th>', cells: (row) => `<td class="deriv-c">${row.derivs.sum % 10}</td>`, headRow: '<th class="mx-issue-h">期号</th>' }),
    ac: () => ({ kind: 'single', th: '<th class="deriv-h">AC值</th>', cells: (row) => {
      const r = row.redCells.filter((c) => c.hit).map((c) => c.num).sort((a, b) => a - b); let diffs = new Set();
      for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) diffs.add(Math.abs(r[i] - r[j]));
      return `<td class="deriv-c">${diffs.size - (r.length - 1)}</td>`;
    }, headRow: '<th class="mx-issue-h">期号</th>' }),
    zone: () => {
      const head = () => Array.from({ length: 33 }, (_, i) => `<th class="mx2-th">${pad2(i + 1)}</th>`).join('');
      return { kind: 'cells', head: head(), cells: (row) => row.redCells.map((c) => {
        if (c.hit) return `<td class="mx2-cell hit"><span class="mx2-ball r"></span></td>`;
        return `<td class="mx2-cell" style="background:${cellBg(c.miss)};color:#9aa8c0">${c.num <= 11 ? '一' : c.num <= 22 ? '二' : '三'}</td>`;
      }).join(''), headRow: '<th class="mx-issue-h">期号</th>' };
    },
    tail: () => {
      const head = () => Array.from({ length: 33 }, (_, i) => `<th class="mx2-th">${pad2(i + 1)}</th>`).join('');
      return { kind: 'cells', head: head(), cells: (row) => row.redCells.map((c) => {
        if (c.hit) return `<td class="mx2-cell hit"><span class="mx2-ball r"></span></td>`;
        return `<td class="mx2-cell" style="background:${cellBg(c.miss)};color:#9aa8c0">${c.num % 10}</td>`;
      }).join(''), headRow: '<th class="mx-issue-h">期号</th>' };
    },
    rmiss: () => {
      const head = () => Array.from({ length: 33 }, (_, i) => `<th class="mx2-th">${pad2(i + 1)}</th>`).join('');
      return { kind: 'cells', head: head(), cells: (row) => row.redCells.map((c) => `<td class="mx2-cell" style="background:${cellBg(c.miss)};color:#b85a6a;font-weight:700">${c.miss}</td>`).join(''), headRow: '<th class="mx-issue-h">期号</th>' };
    },
    bmiss: () => {
      const head = () => Array.from({ length: 16 }, (_, i) => `<th class="mx2-th">${pad2(i + 1)}</th>`).join('');
      const cells = (row, idx) => {
        let html = '';
        for (let n = 1; n <= 16; n++) {
          let miss = 0;
          for (let i = idx; i >= 0; i--) { if (draws[draws.length - m.sliceLen + i].blue === n) break; miss++; }
          html += `<td class="mx2-cell" style="background:${cellBg(miss)};color:#1c6ceb;font-weight:700">${miss}</td>`;
        }
        return html;
      };
      return { kind: 'cells', head: head(), cells, headRow: '<th class="mx-issue-h">期号</th>' };
    },
    summ: () => {
      // 和值区间遗漏：把和值映射到 8 个区间（同 sumBucket）
      const sb = (s) => {
        if (s < 70) return '≤69';
        if (s < 80) return '70-79';
        if (s < 90) return '80-89';
        if (s < 100) return '90-99';
        if (s < 110) return '100-109';
        if (s < 120) return '110-119';
        if (s < 130) return '120-129';
        return '≥130';
      };
      const buckets = ['≤69', '70-79', '80-89', '90-99', '100-109', '110-119', '120-129', '≥130'];
      const th = buckets.map((b) => `<th class="mx2-th" style="min-width:46px">${b}</th>`).join('');
      const cells = (row) => {
        const cur = sb(row.derivs.sum);
        return buckets.map((b) => {
          const hit = b === cur;
          return `<td class="mx2-cell ${hit ? 'hit' : ''}" style="background:${cellBg(0)};${hit ? 'color:#d3212e;font-weight:700' : 'color:#9aa8c0'}">${hit ? '●' : ''}</td>`;
        }).join('');
      };
      return { kind: 'cells', head: th, cells, headRow: '<th class="mx-issue-h">期号</th>' };
    },
  };
  const conf = cols[mxTab] ? cols[mxTab]() : null;
  if (!conf) { $('#trendBox').innerHTML = '<div class="loading">未实现</div>'; return; }

  // 生成行
  let rowsHtml = '';
  m.rows.forEach((row, ri) => {
    let html = `<th class="mx-issue">${row.issue.slice(-5)}<br><span class="mx-date">${row.date.slice(5)}</span></th>`;
    if (conf.kind === 'cells') {
      const idx = m.sliceLen - 1 - ri;
      html += conf.cells(row, idx);
    } else {
      html += conf.cells(row);
    }
    rowsHtml += `<tr>${html}</tr>`;
  });
  const headRow1 = conf.headRow + '<th colspan="' + (conf.head ? conf.head.split('</th>').length - 1 : 1) + '" class="grp-h">' + ({
    consec: '连号形态', repeat: '与上期重复的号', bsize: '红球大小(1-17小/18-33大)', boe: '红球奇偶', bzh: '红球质合', b012: '红球012路(除3余数)',
    sum: '和值', span: '跨度', sumt: '和尾', ac: 'AC值(复杂程度)', zone: '区间(一区/二区/三区)', tail: '尾数(0-9)',
    rmiss: '红球当前遗漏(33号)', bmiss: '蓝球当前遗漏(16号)', summ: '和值区间(本期所在区间打●)',
  }[mxTab] || mxTab) + '</th>';
  const headRow2 = conf.head || conf.th;

  $('#trendBox').innerHTML = `
    <div style="display:flex;gap:6px;margin-bottom:10px">
      <button class="btn ghost" id="goMenu" style="flex:1;font-size:12px;padding:8px">☰ 20种走势</button>
      <button class="btn ghost" id="goQuery" style="flex:1;font-size:12px;padding:8px">条件查询</button>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:10px;align-items:center">
      <span class="hint" style="margin:0;font-size:11px">字号</span>
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
          <tr>${headRow1}</tr>
          <tr>${headRow2}</tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="mx-legend">
      <span><i class="mx2-ball r"></i>出号</span>
      <span>数字=连续未出期数/本期值</span>
    </div>
  `;
  $('#mxPresets').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    mxN = +b.dataset.n;
    $('#mxPresets').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderSubTrend(draws);
  });
  $('#goMenu').onclick = () => renderTrendMenu();
  $('#goQuery').onclick = () => switchPage('query');
  // 字号缩放：通过 CSS 变量控制
  const applyZoom = (z) => {
    document.documentElement.style.setProperty('--mx-cell', (22 * z) + 'px');
    document.documentElement.style.setProperty('--mx-font', (10.5 * z) + 'px');
    document.documentElement.style.setProperty('--mx-ball', (18 * z) + 'px');
    document.documentElement.style.setProperty('--mx-ballfont', (10 * z) + 'px');
  };
  let mxZoom = 1;
  const z = +localStorage.getItem('ssqMxZoom') || 1;
  mxZoom = z; applyZoom(z);
  $('#mxZoomIn').onclick = () => { mxZoom = Math.min(1.8, +(mxZoom + 0.15).toFixed(2)); applyZoom(mxZoom); localStorage.setItem('ssqMxZoom', mxZoom); };
  $('#mxZoomOut').onclick = () => { mxZoom = Math.max(0.6, +(mxZoom - 0.15).toFixed(2)); applyZoom(mxZoom); localStorage.setItem('ssqMxZoom', mxZoom); };
}

function renderMatrixView(draws) {
  const N = matrixN > draws.length ? draws.length : matrixN;
  const m = SSQStats.matrix(draws, N);
  const maxHeat = Math.max(N, 1);
  // 冷热色：heat=0 浅蓝灰, heat=大 深红
  function heatBg(h) {
    const t = Math.min(1, h / maxHeat);
    // 220,235,255 蓝灰 -> 255,200,200 浅红
    const r = Math.round(220 + (255 - 220) * t);
    const g = Math.round(235 + (200 - 235) * t);
    const b = Math.round(255 + (200 - 255) * t);
    return `rgb(${r},${g},${b})`;
  }
  // 表头
  const hth = (h) => `<th class="mx-col ${h.group ? 'g' + h.group : 'r'}" title="遗漏 ${h.miss}期 / 近${N}期出现 ${h.heat}次">
    <div class="mx-num">${h.label}</div><div class="mx-miss">漏${h.miss}</div></th>`;
  const headRed = m.headers.red.map(hth).join('');
  const headBlue = m.headers.blue.map(hth).join('');
  // 行
  const rowsHtml = m.rows.map((row) => {
    // 33个红球列：出现则插球，未出则显示色块（按该号heat）
    const redCells = m.headers.red.map((h) => {
      const hit = row.redCells.find((c) => c.num === h.num);
      if (hit) {
        const cls = hit.state === 'repeat' ? 'mx-ball r repeat' : 'mx-ball r hit';
        return `<td class="mx-cell ${hit.state === 'repeat' ? 'rpt' : 'hit'}" style="background:${heatBg(h.heat)}"><span class="${cls}">${pad(h.num)}</span></td>`;
      }
      return `<td class="mx-cell miss" style="background:${heatBg(h.heat)}"></td>`;
    }).join('');
    const blueCell = m.headers.blue.map((h) => {
      if (h.num === row.blueCell.num) {
        const cls = row.blueCell.state === 'repeat' ? 'mx-ball b repeat' : 'mx-ball b hit';
        return `<td class="mx-cell ${row.blueCell.state === 'repeat' ? 'rpt' : 'hit'}" style="background:${heatBg(h.heat)}"><span class="${cls}">${pad(h.num)}</span></td>`;
      }
      return `<td class="mx-cell miss" style="background:${heatBg(h.heat)}"></td>`;
    }).join('');
    return `<tr><th class="mx-issue">${row.issue.slice(-5)}<br><span class="mx-date">${row.date.slice(5)}</span></th>${redCells}${blueCell}</tr>`;
  }).join('');
  // 快捷按钮
  const presets = [30, 50, 80, 120, 300, 500];
  const presetHtml = presets.map((n) => `<button data-n="${n}" class="${matrixN === n ? 'on' : ''}">近${n}期</button>`).join('')
    + `<button data-n="0" class="${matrixN === 0 ? 'on' : ''}">全部</button>`;
  $('#trendBox').innerHTML = `
    <div class="seg" id="viewSeg" style="margin-bottom:10px">
      <button data-v="matrix" class="on">号码矩阵</button>
      <button data-v="detail">明细统计</button>
    </div>
    <div class="mx-toolbar">
      <div class="seg" id="mxPresets" style="margin:0;flex:1">${presetHtml}</div>
    </div>
    <div class="mx-wrap">
      <table class="mx-table">
        <thead>
          <tr><th class="mx-issue-h">期号</th>${headRed}<th class="mx-sep"></th>${headBlue}</tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="mx-legend">
      <span><i class="ball r sm" style="background:linear-gradient(145deg,#f45b64,#d3212e);color:#fff"></i>本期新出</span>
      <span><i class="mx-ball r repeat">05</i>重号(与上期相同)</span>
      <span>冷色块=该号近${N}期出现少，热色块=出现多</span>
    </div>
  `;
  // 切换"号码矩阵 / 明细统计"
  $('#viewSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    trendView = b.dataset.v;
    $('#viewSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderTrend();
  });
  $('#mxPresets').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    matrixN = +b.dataset.n;
    $('#mxPresets').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderMatrixView(draws);
  });
}

function renderRedTrend(draws) {
  const rt = SSQStats.redTrend(draws);
  const rows = [...rt.rows].sort((a, b) => b.curMiss - a.curMiss);
  const h = [];
  h.push(`<div class="seg" id="viewSeg" style="margin-bottom:10px">
    <button data-v="matrix">号码矩阵</button>
    <button data-v="detail" class="on">明细统计</button>
  </div>`);
  h.push(`<div class="statGrid" style="margin-bottom:12px">
    <div class="statBox"><div class="k" style="margin:0 0 6px">最热红球（出现最多）</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${rt.hot.map((r) => `<span class="ball r sm" title="${r.freq}次">${pad(r.num)}</span>`).join('')}</div></div>
    <div class="statBox"><div class="k" style="margin:0 0 6px">遗漏最长红球（最冷）</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${rt.cold.map((r) => `<span class="ball r sm" title="遗漏${r.curMiss}期" style="opacity:.55">${pad(r.num)}</span>`).join('')}</div></div>
  </div>`);
  h.push(`<h3>红球明细 <span class="tail">按当前遗漏排序 · 出现率期望≈18.2%</span></h3>`);
  h.push(`<table class="trendTable"><tr><th>红球</th><th>分区</th><th>出现</th><th>频率</th><th>当前遗漏</th><th>最大遗漏</th></tr>`);
  rows.forEach((r) => {
    const missCls = r.curMiss >= 15 ? 'coldTag' : '';
    const hotCls = r.pct >= 20 ? 'hotTag' : '';
    h.push(`<tr><td class="num"><span class="ball r sm">${pad(r.num)}</span></td><td>${['一区', '二区', '三区'][r.zone]}</td><td class="${hotCls}">${r.freq}</td><td>${r.pct}%</td><td class="${missCls}">${r.curMiss}</td><td>${r.maxMiss}</td></tr>`);
  });
  h.push('</table>');
  $('#trendBox').innerHTML = h.join('');
  $('#viewSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    trendView = b.dataset.v;
    $('#viewSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderTrend();
  });
}
function renderBlueTrend(draws) {
  const bt = SSQStats.blueTrend(draws);
  const rows = [...bt.rows].sort((a, b) => b.curMiss - a.curMiss);
  const h = [];
  if (bt.latest) {
    h.push(`<div class="latest" style="padding:12px 14px; margin-bottom:12px;">
      <div class="row1" style="margin-bottom:8px"><span class="issue" style="font-size:16px">${bt.latest.issue}</span><span class="date">最新蓝球</span></div>
      <div class="balls"><span class="ball b lg">${pad(bt.latest.blue)}</span>
      <span class="tag" style="font-size:13px;padding:6px 14px">${bt.latest.group}组 · ${SSQStats.BLUE_GROUPS[bt.latest.group].join(' / ')}</span></div>
    </div>`);
  }
  // 四分组卡片
  const gOrder = ['A', 'B', 'C', 'D'];
  h.push(gOrder.map((g) => {
    const G = bt.groups[g];
    return `<div class="groupCard g${g}">
      <div class="gHead"><div class="gDot">${g}</div>
        <div><div class="gName">${G.name}（除4${g === 'D' ? '余0' : '余' + 'ABC'.indexOf(g) + 1}）</div>
        <div class="gNums">${G.nums.map((n) => pad(n)).join(' · ')}</div></div></div>
      <div class="gStats">
        <div><div class="v">${G.freq}</div><div class="k">出现次数</div></div>
        <div><div class="v">${G.pct}%</div><div class="k">占比</div></div>
        <div><div class="v">${G.curMiss}</div><div class="k">当前遗漏</div></div>
        <div><div class="v">${G.maxMiss}</div><div class="k">最大遗漏</div></div>
      </div>
      <div class="hint" style="margin-top:8px">近30期出现 <b>${G.recent30}</b> 次</div>
    </div>`;
  }).join(''));
  // 组走势
  h.push(`<h3 style="margin:14px 0 6px">最近20期蓝球组走势</h3>`);
  h.push(`<div class="legend">${'ABCD'.split('').map((g) => `<span><i style="background:var(--g${g})"></i>${g}组</span>`).join('')}</div>`);
  h.push(`<div class="flowRow">${bt.recentFlow.map((f) => `<div class="flowCell"><div class="fc ${f.group}">${f.blue}</div><div class="fi">${f.issue}</div></div>`).join('')}</div>`);
  // 16号明细
  h.push(`<h3 style="margin:14px 0 4px">蓝球明细 <span class="tail">按当前遗漏排序</span></h3>`);
  h.push(`<table class="trendTable"><tr><th>蓝球</th><th>分组</th><th>出现</th><th>频率</th><th>当前遗漏</th><th>最大遗漏</th></tr>`);
  rows.forEach((r) => {
    h.push(`<tr><td class="num"><span class="ball b sm">${pad(r.num)}</span></td><td>${r.group}组</td><td>${r.freq}</td><td>${r.pct}%</td><td class="${r.curMiss >= 20 ? 'coldTag' : ''}">${r.curMiss}</td><td>${r.maxMiss}</td></tr>`);
  });
  h.push('</table>');
  $('#trendBox').innerHTML = h.join('');
}
$('#trendSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  trendType = b.dataset.t;
  document.querySelectorAll('#trendSeg button').forEach((x) => x.classList.toggle('on', x === b));
  renderTrend();
});

// ===== 路由 =====
function switchPage(p) {
  curPage = p;
  document.querySelectorAll('.page').forEach((s) => s.classList.toggle('active', s.id === 'page-' + p));
  document.querySelectorAll('nav button[data-page]').forEach((b) => b.classList.toggle('on', b.dataset.page === p));
  if (location.hash !== '#' + p) history.replaceState(null, '', '#' + p);
  window.scrollTo({ top: 0 });
  // 切页时让顶栏重新显示
  const h = document.querySelector('header'); if (h) h.classList.remove('collapsed');
}
// 顶栏下拉自动隐藏：scrollY > 50 隐藏，回到顶部恢复。rAF 节流避免卡顿。
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
  else if (p === 'trend-blue') { // 直达蓝球视图
    trendType = 'blue';
    document.querySelectorAll('#trendSeg button').forEach((x) => x.classList.toggle('on', x.dataset.t === 'blue'));
    switchPage('trend');
  }
}

// ===== 其他 =====
$('#refreshBtn').onclick = async () => {
  toast('正在刷新数据…');
  try { await loadData(true); toast('数据已刷新'); }
  catch (e) { toast('刷新失败：' + e.message); }
};
$('#installBtn').onclick = () => $('#installModal').classList.add('show');
$('#closeModal').onclick = () => $('#installModal').classList.remove('show');
$('#installModal').onclick = (e) => { if (e.target.id === 'installModal') e.target.classList.remove('show'); };
window.addEventListener('error', (e) => {
  const b = $('#errbox'); b.style.display = 'block';
  b.textContent += (e.message || 'error') + ' @' + (e.filename || '') + ':' + (e.lineno || '') + '\n';
});

loadData().catch((e) => {
  $('#srcInfo').textContent = '数据加载失败';
  $('#latestBox').innerHTML = `<div class="card"><div class="loading">数据加载失败：${esc(e.message)}<br>请点击右上角 ⟳ 重试</div></div>`;
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/**
 * 自动定时刷新：开奖日（周二/四/日）21:30后每分钟尝试拉取最新
 * 其它时段：每 6 小时刷新一次
 */
function isDrawDay(d) { return d.getDay() === 2 || d.getDay() === 4 || d.getDay() === 0; }
function isDrawWindow(d) {
  if (!isDrawDay(d)) return false;
  const m = d.getHours() * 60 + d.getMinutes();
  return m >= 21 * 60 + 15 && m <= 23 * 60 + 30;
}
let lastIssueSeen = '';
async function autoTick() {
  // 静态部署无 /api/draws 时静默跳过
  if (location.protocol === 'file:' || (typeof window.__STATIC_DEPLOY === 'boolean' && window.__STATIC_DEPLOY)) return;
  const now = new Date();
  if (isDrawWindow(now) || now.getMinutes() % 60 === 0) {
    try {
      const r = await fetch('/api/draws?lotto=ssq', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      const latestInfo = j.latestMeta || j.latest;
      if (j.ok && latestInfo) {
        const newIssue = latestInfo.issue;
        if (newIssue !== lastIssueSeen && lastIssueSeen) {
          toast(`✨ 已开奖 ${newIssue}，已自动更新`);
          await loadData(true);
          await loadLatestMeta().catch(() => {});
        }
        lastIssueSeen = newIssue;
      }
    } catch (e) { /* 静默 */ }
  }
}
setInterval(autoTick, 60 * 1000);
console.log('[定时刷新] 前端已启动');
