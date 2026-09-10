// tools/update_snapshots.mjs
// 抓取 500 彩票网最新开奖数据，覆盖更新 ssq/snapshot.js 与 dlt/snapshot.js
// 由 GitHub Actions 定时调用（也可本地手动运行：node tools/update_snapshots.mjs）
//
// 设计要点：
// 1. 抓取失败绝不破坏原有快照（先写临时文件，校验通过才覆盖）
// 2. 期号格式统一：SSQ 7 位（2026104），DLT 5 位（26104）
// 3. 输出为前端可直接 <script> 引入的 window.__SNAPSHOT__ 赋值形式

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// 自动探测快照文件所在目录：
//  - 若 <repo>/public/ssq/snapshot.js 存在 → 用 public/ 结构（本地开发）
//  - 否则 → 用仓库根目录结构（GitHub 仓库实际结构：ssq/、dlt/ 在根目录）
const hasPublic = fs.existsSync(path.join(ROOT, 'public', 'ssq', 'snapshot.js'));
const SNAP_DIR = hasPublic ? path.join(ROOT, 'public') : ROOT;
console.log(`[init] 快照目录: ${SNAP_DIR}`);

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const CFG = {
  ssq: {
    page: 'https://datachart.500.com/ssq/history/history.shtml',
    frontLen: 6,
    backLen: 1,
    poolIdx: 9,
    j1c: 10, j1m: 11, j2c: 12, j2m: 13,
    salesIdx: 14,
    dateIdx: 15,
    issuePad: true, // 5 位 → 7 位
    snapFile: path.join(SNAP_DIR, 'ssq', 'snapshot.js'),
  },
  dlt: {
    page: 'https://datachart.500.com/dlt/history/history.shtml',
    frontLen: 5,
    backLen: 2,
    poolIdx: 8,
    j1c: 9, j1m: 10, j2c: 11, j2m: 12,
    salesIdx: 13,
    dateIdx: 14,
    issuePad: false,
    snapFile: path.join(SNAP_DIR, 'dlt', 'snapshot.js'),
  },
};

function num(s) {
  if (s == null) return 0;
  const n = parseInt(String(s).replace(/,/g, '').replace(/&nbsp;/g, '').trim(), 10);
  return isNaN(n) ? 0 : n;
}

/** 读取现有快照文件，解析出 JSON（失败返回 null） */
function readExisting(snapFile) {
  try {
    const text = fs.readFileSync(snapFile, 'utf8');
    const m = /window\.__SNAPSHOT__\s*=\s*([\s\S]*?);?\s*$/.exec(text.trim());
    if (!m) return null;
    return JSON.parse(m[1].trim().replace(/;$/, ''));
  } catch (e) {
    return null;
  }
}

/** 抓取 500.com 并解析出全部开奖记录 */
async function fetchAndParse(lotto) {
  const cfg = CFG[lotto];
  const resp = await fetch(cfg.page, {
    headers: {
      'User-Agent': UA,
      Referer: 'https://datachart.500.com/',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!resp.ok) throw new Error('500.com HTTP ' + resp.status);
  const buf = await resp.arrayBuffer();
  // 500.com 使用 GB2312 编码
  const html = new TextDecoder('gb2312').decode(buf);

  const tb = /<tbody id="tdata">([\s\S]*?)<\/tbody>/.exec(html);
  if (!tb) throw new Error('未找到 tdata 数据块');
  // 去掉 HTML 注释（行内有 <!--<td>2</td>--> 会干扰解析）
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

  // 500.com 返回顺序为新→旧，转为升序（旧→新），与现有快照一致
  draws.reverse();

  const latest = draws[draws.length - 1];
  const f = latest._meta;
  const clean = draws.map(({ _meta, ...d }) => d);

  const latestMeta = {
    issue: latest.issue,
    date: latest.date,
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

  return { clean, latestMeta };
}

/** 合并：以新抓取的全量数据为准，但保留旧快照里多出来的历史期（防 500.com 页面只返回近 N 期） */
function mergeSnapshots(oldSnap, freshDraws) {
  const map = new Map();
  if (oldSnap && Array.isArray(oldSnap.draws)) {
    for (const d of oldSnap.draws) map.set(d.issue, d);
  }
  let added = 0;
  for (const d of freshDraws) {
    if (!map.has(d.issue)) {
      map.set(d.issue, d);
      added++;
    } else {
      // 已存在则用新抓取的数据覆盖（保证中奖信息最新）
      map.set(d.issue, d);
    }
  }
  const all = Array.from(map.values());
  all.sort((a, b) => (a.issue < b.issue ? -1 : a.issue > b.issue ? 1 : 0));
  return { all, added };
}

async function updateOne(lotto) {
  const cfg = CFG[lotto];
  console.log(`\n[${lotto}] 抓取 ${cfg.page} ...`);

  const old = readExisting(cfg.snapFile);
  const oldCount = old && old.draws ? old.draws.length : 0;
  const oldLatest = old && old.latest ? old.latest.issue : '(无)';
  console.log(`[${lotto}] 现有快照: ${oldCount} 期，最新 ${oldLatest}`);

  const { clean, latestMeta } = await fetchAndParse(lotto);
  console.log(`[${lotto}] 抓取到 ${clean.length} 期，最新 ${clean[clean.length - 1].issue}`);

  const { all, added } = mergeSnapshots(old, clean);
  const latest = clean[clean.length - 1];
  const newLatestIssue = latest.issue;
  const oldLatestIssue = old && old.latest ? old.latest.issue : null;

  // 幂等保护：最新期号与旧快照一致 且 期数未增加时，不写文件，避免无意义提交
  if (added === 0 && oldLatestIssue === newLatestIssue && oldCount === all.length) {
    console.log(`[${lotto}] ⏭  无新开奖数据（最新仍为 ${newLatestIssue}），文件保持不变`);
    return { oldCount, newCount: all.length, added: 0, latestIssue: newLatestIssue, latestDate: latest.date, skipped: true };
  }

  const snapObj = {
    updatedAt: new Date().toISOString(),
    source: '500彩票网',
    count: all.length,
    latest: lotto === 'ssq'
      ? { issue: latest.issue, date: latest.date, reds: latest.reds, blue: latest.blue }
      : { issue: latest.issue, date: latest.date, front: latest.front, back: latest.back },
    latestMeta,
    draws: all,
  };

  const payload = JSON.stringify(snapObj);
  const out = 'window.__SNAPSHOT__=' + payload + ';\n';
  // 先写临时文件，校验 JSON 可解析后再原子覆盖
  const tmp = cfg.snapFile + '.tmp';
  fs.writeFileSync(tmp, out, 'utf8');
  JSON.parse(payload); // 校验
  fs.renameSync(tmp, cfg.snapFile);

  console.log(`[${lotto}] ✅ 已更新: ${all.length} 期（新增 ${added} 期），最新 ${latest.issue} ${latest.date}`);
  return { oldCount, newCount: all.length, added, latestIssue: latest.issue, latestDate: latest.date, skipped: false };
}

async function main() {
  const results = {};
  let failed = 0;

  for (const lotto of ['ssq', 'dlt']) {
    try {
      results[lotto] = await updateOne(lotto);
    } catch (e) {
      failed++;
      console.error(`[${lotto}] ❌ 失败: ${e.message}（保留原快照不动）`);
    }
  }

  console.log('\n===== 汇总 =====');
  for (const [k, v] of Object.entries(results)) {
    console.log(`${k}: ${v.oldCount} → ${v.newCount} 期（+${v.added}）${v.skipped ? " [无变化]" : ""}，最新 ${v.latestIssue} ${v.latestDate}`);
  }
  if (failed === 2) {
    console.error('两个彩种都失败，退出码 1');
    process.exit(1);
  }
  console.log('完成。');
}

main();
