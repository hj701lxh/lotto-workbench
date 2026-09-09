/**
 * 双色球统计引擎（UMD：浏览器 + Node 双端共用）
 * 数据格式：升序数组 [{issue, date, reds:[6个1-33升序], blue:1-16}]
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SSQStats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ===== 常量定义 =====
  const ZONES = [
    { name: '一区', min: 1, max: 11 },
    { name: '二区', min: 12, max: 22 },
    { name: '三区', min: 23, max: 33 },
  ];
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
  // 蓝球四分组：A=除4余1，B=除4余2，C=除4余3，D=除4余0
  const BLUE_GROUPS = { A: [1, 5, 9, 13], B: [2, 6, 10, 14], C: [3, 7, 11, 15], D: [4, 8, 12, 16] };
  const blueGroupMap = {};
  Object.keys(BLUE_GROUPS).forEach((g) => BLUE_GROUPS[g].forEach((n) => { blueGroupMap[n] = g; }));
  const zoneOf = (n) => (n <= 11 ? 0 : n <= 22 ? 1 : 2);
  const groupOfBlue = (b) => blueGroupMap[b] || '?';

  // ===== 单期派生指标 =====
  function sumOf(d) { return d.reds.reduce((a, b) => a + b, 0); }
  function oddEvenOf(d) { const o = d.reds.filter((r) => r % 2 === 1).length; return o + ':' + (6 - o); }
  function bigSmallOf(d) { const s = d.reds.filter((r) => r <= 17).length; return s + ':' + (6 - s); } // 1-17小 18-33大
  function spanOf(d) { return d.reds[5] - d.reds[0]; }
  function zoneCounts(d) {
    const c = [0, 0, 0];
    d.reds.forEach((r) => c[zoneOf(r)]++);
    return c; // 如 [2,3,1]
  }
  /** 连号组列表，如 [[5,6],[20,21,22]] */
  function consecOf(d) {
    const groups = [];
    let cur = [d.reds[0]];
    for (let i = 1; i < 6; i++) {
      if (d.reds[i] === d.reds[i - 1] + 1) cur.push(d.reds[i]);
      else { if (cur.length >= 2) groups.push(cur); cur = [d.reds[i]]; }
    }
    if (cur.length >= 2) groups.push(cur);
    return groups;
  }
  /** 与上期的重号 */
  function repeatsOf(d, prev) {
    if (!prev) return [];
    return d.reds.filter((r) => prev.reds.includes(r));
  }

  // ===== 条件查询（核心功能） =====
  /**
   * @param draws 升序数组
   * @param sel   勾选的红球数组，如 [1,3]
   * @param mode  'include' 包含模式：开奖红球包含所有勾选号
   *              'exact'   精确模式：每个有所选号的分区，其开出号码恰好等于该区所选号集合（不多不少）
   * @return {count, hits:[{issue,date,reds,blue,next}], nexts:[...], nextStats}
   */
  function query(draws, sel, mode) {
    sel = (sel || []).slice().sort((a, b) => a - b);
    if (!sel.length) return { count: 0, hits: [], nexts: [], nextStats: null, sel, mode };
    const selSet = new Set(sel);
    const zoneSel = [[], [], []];
    sel.forEach((n) => zoneSel[zoneOf(n)].push(n));

    const isHit = mode === 'exact'
      ? (d) => {
        const zones = zoneCounts(d);
        for (let z = 0; z < 3; z++) {
          if (!zoneSel[z].length) continue;
          // 该区开出个数必须等于所选个数，且开出的正是所选号
          if (zones[z] !== zoneSel[z].length) return false;
          for (const r of d.reds) if (zoneOf(r) === z && !selSet.has(r)) return false;
        }
        return true;
      }
      : (d) => sel.every((n) => d.reds.includes(n));

    const hits = [];
    for (let i = 0; i < draws.length; i++) {
      if (!isHit(draws[i])) continue;
      const next = i + 1 < draws.length ? draws[i + 1] : null;
      hits.push(pick(draws[i], next, draws[i - 1] || null));
    }
    const nexts = hits.filter((h) => h.next).map((h) => h.next);
    return {
      count: hits.length,
      sel, mode,
      hits,
      nexts,
      nextStats: nexts.length ? analyzeNexts(hits) : null,
      skippedNoNext: hits.length - nexts.length,
    };
  }

  function pick(d, next, prev) {
    return {
      issue: d.issue, date: d.date, reds: d.reds, blue: d.blue,
      sum: sumOf(d), oddEven: oddEvenOf(d), zoneCounts: zoneCounts(d),
      consec: consecOf(d), repeats: repeatsOf(d, prev),
      next: next ? nextPick(next, d) : null,
    };
  }

  function nextPick(next, hitDraw) {
    return {
      issue: next.issue, date: next.date, reds: next.reds, blue: next.blue,
      sum: sumOf(next), oddEven: oddEvenOf(next), zoneCounts: zoneCounts(next),
      consec: consecOf(next),
      repeats: next.reds.filter((r) => hitDraw.reds.includes(r)),
      blueGroup: groupOfBlue(next.blue),
    };
  }

  /** 命中期的下一期汇总统计 */
  function analyzeNexts(hits) {
    const nexts = hits.filter((h) => h.next).map((h) => h.next);
    const n = nexts.length;
    const redFreq = {}; const blueFreq = {}; const groupFreq = { A: 0, B: 0, C: 0, D: 0 };
    const zoneDist = { 0: {}, 1: {}, 2: {} }; // 各区出号个数分布
    const sumBuckets = {}; const oddEvenDist = {}; const spanDist = {};
    let consecCnt = 0; let repeatCnt = 0; let repeatNums = {};
    let sumTotal = 0;
    nexts.forEach((d) => {
      d.reds.forEach((r) => { redFreq[r] = (redFreq[r] || 0) + 1; });
      blueFreq[d.blue] = (blueFreq[d.blue] || 0) + 1;
      groupFreq[groupOfBlue(d.blue)]++;
      d.zoneCounts.forEach((c, z) => { zoneDist[z][c] = (zoneDist[z][c] || 0) + 1; });
      sumTotal += d.sum;
      const sb = sumBucket(d.sum); sumBuckets[sb] = (sumBuckets[sb] || 0) + 1;
      oddEvenDist[d.oddEven] = (oddEvenDist[d.oddEven] || 0) + 1;
      spanDist[d.zoneSpan = d.reds[5] - d.reds[0]] = (spanDist[d.zoneSpan] || 0) + 1;
      if (d.consec.length) consecCnt++;
      if (d.repeats.length) { repeatCnt++; d.repeats.forEach((r) => { repeatNums[r] = (repeatNums[r] || 0) + 1; }); }
    });
    const top = (obj, k) => Object.entries(obj).map(([v, c]) => [isNaN(+v) ? v : +v, c]).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, k);
    return {
      total: n,
      avgSum: +(sumTotal / n).toFixed(1),
      redTop: top(redFreq, 10),
      blueTop: top(blueFreq, 8),
      groupDist: groupFreq,
      groupTop: top(groupFreq, 4).map(([g, c]) => [g + '组', c]),
      zoneDist: {
        一区: top(zoneDist[0], 7), 二区: top(zoneDist[1], 7), 三区: top(zoneDist[2], 7),
      },
      sumBuckets: top(sumBuckets, 99).sort((a, b) => a[0] - b[0]),
      oddEvenTop: top(oddEvenDist, 7),
      spanTop: top(spanDist, 8).sort((a, b) => a[0] - b[0]),
      consecRate: +(consecCnt / n * 100).toFixed(1),
      repeatRate: +(repeatCnt / n * 100).toFixed(1),
      repeatNumsTop: top(repeatNums, 10),
    };
  }

  function sumBucket(s) {
    if (s < 70) return '≤69';
    if (s < 80) return '70-79';
    if (s < 90) return '80-89';
    if (s < 100) return '90-99';
    if (s < 110) return '100-109';
    if (s < 120) return '110-119';
    if (s < 130) return '120-129';
    return '≥130';
  }
  const SUM_ORDER = ['≤69', '70-79', '80-89', '90-99', '100-109', '110-119', '120-129', '≥130'];

  // ===== 基本统计（连号/重号/单双/和值/大小/跨度） =====
  function basicStats(draws) {
    const n = draws.length;
    if (!n) return null;
    let two = 0, three = 0, fourPlus = 0, noConsec = 0;
    let repeatIssues = 0, repeatTotalNums = 0;
    const oddEvenDist = {}, sumArr = [], spanDist = {}, bigSmallDist = {};
    const sumBuckets = {};
    draws.forEach((d, i) => {
      const cg = consecOf(d);
      if (!cg.length) noConsec++;
      const maxLen = cg.length ? Math.max(...cg.map((g) => g.length)) : 1;
      if (maxLen >= 4) fourPlus++;
      else if (maxLen === 3) three++;
      else if (maxLen === 2) two++;
      const rep = repeatsOf(d, draws[i - 1]);
      if (i > 0) { if (rep.length) { repeatIssues++; repeatTotalNums += rep.length; } }
      const oe = oddEvenOf(d); oddEvenDist[oe] = (oddEvenDist[oe] || 0) + 1;
      const bs = bigSmallOf(d); bigSmallDist[bs] = (bigSmallDist[bs] || 0) + 1;
      const s = sumOf(d); sumArr.push(s);
      const sb = sumBucket(s); sumBuckets[sb] = (sumBuckets[sb] || 0) + 1;
      const sp = spanOf(d); spanDist[sp] = (spanDist[sp] || 0) + 1;
    });
    sumArr.sort((a, b) => a - b);
    const pct = (x) => +(x / n * 100).toFixed(1);
    return {
      count: n,
      range: { first: draws[0].issue, last: draws[n - 1].issue },
      consec: {
        none: [noConsec, pct(noConsec)], two: [two, pct(two)],
        three: [three, pct(three)], fourPlus: [fourPlus, pct(fourPlus)],
        rate: +((n - noConsec) / n * 100).toFixed(1),
      },
      repeat: {
        issues: [repeatIssues, pct(repeatIssues)],
        avgNums: +(repeatTotalNums / Math.max(1, repeatIssues)).toFixed(2),
        rate: +(repeatIssues / Math.max(1, n - 1) * 100).toFixed(1),
      },
      oddEven: sortEntries(oddEvenDist),
      bigSmall: sortEntries(bigSmallDist),
      sum: {
        min: sumArr[0], max: sumArr[n - 1], avg: +(sumArr.reduce((a, b) => a + b, 0) / n).toFixed(1),
        median: n % 2 ? sumArr[(n - 1) / 2] : +((sumArr[n / 2 - 1] + sumArr[n / 2]) / 2).toFixed(1),
        buckets: SUM_ORDER.map((k) => [k, sumBuckets[k] || 0]),
      },
      span: Object.entries(spanDist).map(([v, c]) => [+v, c]).sort((a, b) => a[0] - b[0]),
    };
  }

  function sortEntries(obj) {
    return Object.entries(obj).map(([k, v]) => [k, v]).sort((a, b) => b[1] - a[1]);
  }

  // ===== 红球走势（频率/遗漏/冷热） =====
  function redTrend(draws) {
    const freq = {}, lastIdx = {}, maxMiss = {};
    for (let i = 0; i < draws.length; i++) {
      for (const r of draws[i].reds) {
        freq[r] = (freq[r] || 0) + 1;
        if (lastIdx[r] !== undefined) {
          const gap = i - lastIdx[r] - 1;
          if (gap > (maxMiss[r] || 0)) maxMiss[r] = gap;
        }
        lastIdx[r] = i;
      }
    }
    // 当前遗漏：从最后一期往前数连续未出的期数
    const curMiss = {};
    for (let n = 1; n <= 33; n++) {
      let m = 0;
      for (let i = draws.length - 1; i >= 0; i--) {
        if (draws[i].reds.includes(n)) break;
        m++;
      }
      curMiss[n] = m;
    }
    const rows = [];
    for (let n = 1; n <= 33; n++) {
      rows.push({
        num: n, zone: zoneOf(n),
        freq: freq[n] || 0,
        pct: +((freq[n] || 0) / draws.length * 100).toFixed(1),
        curMiss: curMiss[n],
        maxMiss: maxMiss[n] || 0,
      });
    }
    const hot = [...rows].sort((a, b) => b.freq - a.freq || a.num - b.num).slice(0, 8);
    const cold = [...rows].sort((a, b) => b.curMiss - a.curMiss || a.num - b.num).slice(0, 8);
    return { rows, hot, cold, total: draws.length, latest: draws[draws.length - 1] };
  }

  // ===== 蓝球走势 + 四分组 =====
  function blueTrend(draws) {
    const freq = {}, maxMiss = {};
    const lastIdx = {};
    for (let i = 0; i < draws.length; i++) {
      const b = draws[i].blue;
      freq[b] = (freq[b] || 0) + 1;
      if (lastIdx[b] !== undefined) {
        const gap = i - lastIdx[b] - 1;
        if (gap > (maxMiss[b] || 0)) maxMiss[b] = gap;
      }
      lastIdx[b] = i;
    }
    const curMiss = {};
    for (let n = 1; n <= 16; n++) {
      let m = 0;
      for (let i = draws.length - 1; i >= 0; i--) { if (draws[i].blue === n) break; m++; }
      curMiss[n] = m;
    }
    const rows = [];
    for (let n = 1; n <= 16; n++) {
      rows.push({ num: n, group: groupOfBlue(n), freq: freq[n] || 0, pct: +((freq[n] || 0) / draws.length * 100).toFixed(1), curMiss: curMiss[n], maxMiss: maxMiss[n] || 0 });
    }
    // 分组统计
    const groups = {};
    Object.keys(BLUE_GROUPS).forEach((g) => {
      const nums = BLUE_GROUPS[g];
      const gFreq = nums.reduce((a, n) => a + (freq[n] || 0), 0);
      // 分组遗漏：连续多少期蓝球不落在该组
      let gMiss = 0;
      for (let i = draws.length - 1; i >= 0; i--) { if (groupOfBlue(draws[i].blue) === g) break; gMiss++; }
      // 分组最大遗漏
      let gMax = 0, run = 0;
      draws.forEach((d) => {
        if (groupOfBlue(d.blue) === g) { if (run > gMax) gMax = run; run = 0; } else run++;
      });
      if (run > gMax) gMax = run;
      // 最近30期组内分布
      const recent = draws.slice(-30);
      const recentFreq = recent.filter((d) => groupOfBlue(d.blue) === g).length;
      groups[g] = { name: g + '组', nums, freq: gFreq, pct: +(gFreq / draws.length * 100).toFixed(1), curMiss: gMiss, maxMiss: gMax, recent30: recentFreq };
    });
    // 最近20期组走势
    const recentFlow = draws.slice(-20).map((d) => ({ issue: d.issue.slice(-3), blue: d.blue, group: groupOfBlue(d.blue) }));
    const latest = draws[draws.length - 1];
    return {
      rows, groups, recentFlow, total: draws.length,
      latest: latest ? { issue: latest.issue, blue: latest.blue, group: groupOfBlue(latest.blue) } : null,
      hot: [...rows].sort((a, b) => b.freq - a.freq || a.num - b.num).slice(0, 5),
      cold: [...rows].sort((a, b) => b.curMiss - a.curMiss || a.num - b.num).slice(0, 5),
    };
  }

  // ===== 号码矩阵（走势矩阵视图） =====
  /**
   * 构造最近 N 期的号码矩阵视图
   * @param draws 升序
   * @param N 期数（默认 30）
   * @return {rows, headers:{red:{miss,heat,label},blue:{...}}, total}
   *   rows: 倒序（最新在前），每行 {issue,date,redCells:[{num,state}],blueCell:{num,state,group}}
   *     state: 'hit'  本期新出 / 'repeat' 重号(上期也开过) / 'miss' 未出
   *   headers: 每个号列的 {miss:当前遗漏期数, heat:近N期出现次数 0~N, label:"01 5"}
   */
  function matrix(draws, N) {
    N = N || 30;
    if (!draws.length) return { rows: [], headers: { red: [], blue: [] }, N: 0 };
    const slice = draws.slice(-N);  // 最近N期（升序），最新期在末尾
    const reversed = slice.slice().reverse(); // 倒序：最新期在前
    const rows = reversed.map((d, i) => {
      // 原数组里 d 对应位置 = draws.length - 1 - i
      const realIdx = draws.length - 1 - i;
      const prev = realIdx > 0 ? draws[realIdx - 1] : null;
      const redSet = new Set(d.reds);
      const redCells = d.reds.slice().sort((a, b) => a - b).map((n) => ({
        num: n, state: prev && prev.reds.includes(n) ? 'repeat' : 'hit',
      }));
      const blueCell = { num: d.blue, state: prev && prev.blue === d.blue ? 'repeat' : 'hit', group: groupOfBlue(d.blue) };
      return { issue: d.issue, date: d.date, redCells, blueCell };
    });
    // 表头：每个红球号 / 蓝球号 的"当前遗漏"（以最后N期为窗口，与红球走势定义的"当前遗漏"对齐：截至最新期未出期数）
    // 当前遗漏：从最新期往前数连续未出的期数
    function curMiss(n, type) {
      let m = 0;
      for (let i = draws.length - 1; i >= 0; i--) {
        if (type === 'red' ? draws[i].reds.includes(n) : draws[i].blue === n) break;
        m++;
      }
      return m;
    }
    // 近N期出现次数
    function inSlice(n, type) {
      return slice.reduce((a, d) => a + (type === 'red' ? (d.reds.includes(n) ? 1 : 0) : (d.blue === n ? 1 : 0)), 0);
    }
    const redHeaders = [];
    for (let n = 1; n <= 33; n++) redHeaders.push({ num: n, miss: curMiss(n, 'red'), heat: inSlice(n, 'red'),       label: pad2(n) });
    const blueHeaders = [];
    for (let n = 1; n <= 16; n++) blueHeaders.push({ num: n, miss: curMiss(n, 'blue'), heat: inSlice(n, 'blue'), label: pad2(n), group: groupOfBlue(n) });
    return { rows, headers: { red: redHeaders, blue: blueHeaders }, N, sliceLen: slice.length };
  }

  // ===== 数字列表矩阵（走势图核心数据） =====
  /**
   * 构造"数字列表"形态的走势图数据
   * 单元格 = 该号从最近一次出现到上一期为止连续未出的期数（0 表示上期出了）
   * 本期出号的格子另存为 hit=true，渲染时画红/蓝圆
   * @param draws 升序
   * @param N 期数
   * @param filter 可选：{weekday:2} 按开奖日过滤 (JS getDay 0=日 1=一 2=二 3=三 4=四)
   * @return {rows, headers:{red,blue,derivs}, N, mode, sliceLen}
   */
  function matrixNum(draws, N, filter) {
    N = N || 50;
    if (!draws.length) return { rows: [], headers: { red: [], blue: [], derivs: ['和值', '跨度', '区间比', '奇偶比'] }, N, mode: 'all' };
    let work = draws;
    if (filter && filter.weekday !== undefined) {
      work = draws.filter((d) => new Date(d.date).getDay() === filter.weekday);
    }
    if (!work.length) return { rows: [], headers: { red: [], blue: [], derivs: ['和值', '跨度', '区间比', '奇偶比'] }, N, mode: filter ? 'weekday' : 'all' };
    const slice = work.slice(-N);
    const reversed = slice.slice().reverse();
    function missAt(idx, num, type) {
      let m = 0;
      for (let i = idx; i >= 0; i--) {
        const hit = type === 'red' ? slice[i].reds.includes(num) : slice[i].blue === num;
        if (hit) break;
        m++;
      }
      return m;
    }
    function heatIn(num, type) {
      return slice.reduce((a, d) => a + (type === 'red' ? (d.reds.includes(num) ? 1 : 0) : (d.blue === num ? 1 : 0)), 0);
    }
    const rows = [];
    reversed.forEach((d, i) => {
      const idx = slice.length - 1 - i;
      const prev = idx > 0 ? slice[idx - 1] : null;
      const redCells = [];
      for (let n = 1; n <= 33; n++) {
        const hit = d.reds.includes(n);
        redCells.push({ num: n, miss: missAt(idx, n, 'red'), hit });
      }
      const blueCell = { num: d.blue, miss: missAt(idx, d.blue, 'blue'), hit: true, group: groupOfBlue(d.blue) };
      const zones = zoneCounts(d);
      const cs = consecOf(d);
      const rps = prev ? d.reds.filter((r) => prev.reds.includes(r)) : [];
      rows.push({
        issue: d.issue, date: d.date,
        redCells, blueCell,
        derivs: { sum: sumOf(d), span: spanOf(d), oddEven: oddEvenOf(d),
          zones: zones.join(':'),
          consec: cs.length ? cs.map((g) => g.join('-')).join(' ') : '—',
          repeats: rps.length ? rps.join(',') : '—' },
      });
    });
    const redH = []; for (let n = 1; n <= 33; n++) redH.push({ num: n, miss: missAt(slice.length - 1, n, 'red'), heat: heatIn(n, 'red'), label: pad2(n) });
    const blueH = []; for (let n = 1; n <= 16; n++) blueH.push({ num: n, miss: missAt(slice.length - 1, n, 'blue'), heat: heatIn(n, 'blue'), label: pad2(n), group: groupOfBlue(n) });
    return {
      rows, headers: { red: redH, blue: blueH, derivs: ['和值', '跨度', '区间比', '奇偶比'] },
      N, sliceLen: slice.length, mode: filter ? 'weekday' : 'all',
    };
  }

  return {
    ZONES, BLUE_GROUPS, zoneOf, groupOfBlue,
    sumOf, oddEvenOf, bigSmallOf, spanOf, zoneCounts, consecOf, repeatsOf, sumBucket, SUM_ORDER,
    query, basicStats, redTrend, blueTrend, analyzeNexts, matrix, matrixNum,
  };
});
