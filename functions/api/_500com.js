// functions/api/_500com.js — 500彩票网抓取与解析共享库
// 注意：下划线开头的文件不会生成路由，仅作为模块被引用。

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const CFG = {
  ssq: {
    page: 'https://datachart.500.com/ssq/history/history.shtml',
    // SSQ 行结构: [0]=期号 [1..6]=红 [7]=蓝 [8]=空 [9]=奖池 [10]=一等奖注数 [11]=一等奖金额 [12]=二等奖注数 [13]=二等奖金额 [14]=总销售额 [15]=日期
    frontLen: 6,
    backLen: 1,
    poolIdx: 9,
    j1c: 10, j1m: 11, j2c: 12, j2m: 13,
    salesIdx: 14,
    dateIdx: 15,
    issuePad: true, // 5位 → 7位（"26104" → "2026104"）
    snapPath: '/ssq/snapshot.js',
  },
  dlt: {
    page: 'https://datachart.500.com/dlt/history/history.shtml',
    // DLT 行结构: [0]=期号 [1..5]=前区 [6..7]=后区 [8]=奖池 [9]=一等奖注数 [10]=一等奖金额 [11]=二等奖注数 [12]=二等奖金额 [13]=总销售额 [14]=日期
    frontLen: 5,
    backLen: 2,
    poolIdx: 8,
    j1c: 9, j1m: 10, j2c: 11, j2m: 12,
    salesIdx: 13,
    dateIdx: 14,
    issuePad: false, // DLT 本身就是 5 位
    snapPath: '/dlt/snapshot.js',
  },
};

function num(s) {
  if (s == null) return 0;
  const n = parseInt(String(s).replace(/,/g, '').replace(/&nbsp;/g, '').trim(), 10);
  return isNaN(n) ? 0 : n;
}

// 抓取并解析 500.com 历史页，返回 { draws: [最新在上], meta } 或抛错
async function fetchAndParse(lotto) {
  const cfg = CFG[lotto];
  if (!cfg) throw new Error('unknown lotto: ' + lotto);

  const resp = await fetch(cfg.page, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://datachart.500.com/',
      'Accept': 'text/html,application/xhtml+xml',
    },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!resp.ok) throw new Error('500.com HTTP ' + resp.status);
  const buf = await resp.arrayBuffer();
  const html = new TextDecoder('gb2312').decode(buf);

  const tb = /<tbody id="tdata">([\s\S]*?)<\/tbody>/.exec(html);
  if (!tb) throw new Error('未找到 tdata 数据块');
  // 去掉 HTML 注释（500.com 行内有 <!--<td>2</td>--> 注释，会干扰 td 解析）
  const rowsHtml = tb[1].replace(/<!--[\s\S]*?-->/g, '');

  const draws = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(rowsHtml)) !== null) {
    const tds = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let t;
    while ((t = tdRe.exec(m[1])) !== null) tds.push(t[1].trim());
    if (tds.length < cfg.dateIdx + 1) continue;

    let issue = tds[0];
    if (!/^\d{5,7}$/.test(issue)) continue;
    if (cfg.issuePad && issue.length === 5) issue = '20' + issue;

    const front = [];
    for (let i = 1; i <= cfg.frontLen; i++) front.push(num(tds[i]));
    const back = [];
    for (let i = cfg.frontLen + 1; i <= cfg.frontLen + cfg.backLen; i++) back.push(num(tds[i]));
    if (front.some((n) => !n)) continue;

    draws.push({
      issue,
      date: tds[cfg.dateIdx],
      ...(lotto === 'ssq' ? { reds: front, blue: back[0] } : { front, back }),
      _meta: {
        poolmoney: num(tds[cfg.poolIdx]),
        sales: num(tds[cfg.salesIdx]),
        j1_cnt: num(tds[cfg.j1c]),
        j1_money: num(tds[cfg.j1m]),
        j2_cnt: num(tds[cfg.j2c]),
        j2_money: num(tds[cfg.j2m]),
      },
    });
  }
  if (!draws.length) throw new Error('解析到 0 期');

  const f = draws[0]._meta; // 最新一期
  const meta = {
    issue: draws[0].issue,
    sales: f.sales,
    poolmoney: f.poolmoney,
    pool: f.poolmoney,
    total: f.sales,
    j1_cnt: f.j1_cnt,
    j1_money: f.j1_money,
    j2_cnt: f.j2_cnt,
    j2_money: f.j2_money,
    prizes: [
      { type: 1, num: f.j1_cnt, money: f.j1_money },
      { type: 2, num: f.j2_cnt, money: f.j2_money },
    ],
    content: '',
    fetchedAt: new Date().toISOString(),
  };

  const clean = draws.map(({ _meta, ...d }) => d);
  return { draws: clean, meta };
}

// 从 Pages 静态资源里读 snapshot.js，提取 __SNAPSHOT__ JSON
async function loadSnapshot(env, lotto) {
  const cfg = CFG[lotto];
  const resp = await env.ASSETS.fetch(new Request(new URL(cfg.snapPath, 'https://placeholder.local')));
  if (!resp.ok) throw new Error('snapshot HTTP ' + resp.status);
  const text = await resp.text();
  const m = /window\.__SNAPSHOT__\s*=\s*([\s\S]*?)<\/script>/.exec(text) || /window\.__SNAPSHOT__\s*=\s*([\s\S]*)$/.exec(text);
  if (!m) throw new Error('snapshot 格式异常');
  return JSON.parse(m[1].trim().replace(/;$/, ''));
}

// 合并：fresh（新，可能含新期）与 snap（全量）。返回升序全量。
function mergeDraws(snapDraws, freshDraws) {
  const map = new Map();
  for (const d of snapDraws) map.set(d.issue, d);
  let added = 0;
  // fresh 最新在上，倒序插入保证重复时保留快照数据
  for (let i = freshDraws.length - 1; i >= 0; i--) {
    const d = freshDraws[i];
    if (!map.has(d.issue)) { map.set(d.issue, d); added++; }
  }
  const all = Array.from(map.values());
  all.sort((a, b) => (a.issue < b.issue ? -1 : a.issue > b.issue ? 1 : 0));
  return { draws: all, added };
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60', // CDN 缓存 1 分钟，防高频抓取被屏蔽
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// 从查询参数或 Referer 推断彩种
function detectLotto(request) {
  const url = new URL(request.url);
  let lotto = (url.searchParams.get('lotto') || '').toLowerCase();
  if (lotto !== 'ssq' && lotto !== 'dlt') {
    const ref = request.headers.get('Referer') || '';
    if (ref.includes('/dlt/')) lotto = 'dlt';
    else if (ref.includes('/ssq/')) lotto = 'ssq';
    else lotto = 'ssq';
  }
  return lotto;
}

export { fetchAndParse, loadSnapshot, mergeDraws, jsonResp, detectLotto, CFG };