/**
 * 大乐透统计引擎（UMD：浏览器 + Node 双端共用）
 * 数据格式：升序数组 [{issue, date, front:[5个1-35升序], back:[2个1-12升序]}]
 * 前区5个 01-35，分5区(7个一组)；后区2个 01-12（不分 ABCD）。
 * 区号: 一区01-07 二区08-14 三区15-21 四区22-28 五区29-35
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DLTStats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ===== 常量 =====
  const FZONES = [
    { name: '一区', min: 1, max: 7 },
    { name: '二区', min: 8, max: 14 },
    { name: '三区', min: 15, max: 21 },
    { name: '四区', min: 22, max: 28 },
    { name: '五区', min: 29, max: 35 },
  ];
  const FNUM = 35;  // 前区号码数
  const BNUM = 12;  // 后区号码数
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
  const fzoneOf = (n) => (n <= 7 ? 0 : n <= 14 ? 1 : n <= 21 ? 2 : n <= 28 ? 3 : 4);
  const zoneName = ['一区', '二区', '三区', '四区', '五区'];

  // ===== 单期派生指标 =====
  function fsumOf(d) { return d.front.reduce((a, b) => a + b, 0); }
  function backsumOf(d) { return d.back.reduce((a, b) => a + b, 0); }
  function foeOf(d) { const o = d.front.filter((r) => r % 2 === 1).length; return o + ':' + (5 - o); }
  function fbsOf(d) { const s = d.front.filter((r) => r <= 17).length; return s + ':' + (5 - s); } // 1-17小 18-35大
  function fspanOf(d) { return d.front[4] - d.front[0]; }
  function fzoneCounts(d) {
    const c = [0, 0, 0, 0, 0];
    d.front.forEach((r) => c[fzoneOf(r)]++);
    return c; // 如 [1,2,1,1,0]
  }
  /** 前区连号组 */
  function fconsecOf(d) {
    const groups = [];
    let cur = [d.front[0]];
    for (let i = 1; i < d.front.length; i++) {
      if (d.front[i] === d.front[i - 1] + 1) cur.push(d.front[i]);
      else { if (cur.length >= 2) groups.push(cur); cur = [d.front[i]]; }
    }
    if (cur.length >= 2) groups.push(cur);
    return groups;
  }
  /** 与上期前区重号 */
  function frepeatsOf(d, prev) {
    if (!prev) return [];
    return d.front.filter((r) => prev.front.includes(r));
  }
  /** 与上期后区重号 */
  function brepeatsOf(d, prev) {
    if (!prev) return [];
    return d.back.filter((r) => prev.back.includes(r));
  }

  // ===== 条件查询（前区 + 后区） =====
  /**
   * @param draws 升序
   * @param selF 勾选前区 [..]
   * @param selB 勾选后区 [..]
   * @param fMode 'include'|'exact'
   * @param bMode 'include'|'exact'
   */
  function query(draws, selF, selB, fMode, bMode) {
    selF = (selF || []).slice().sort((a, b) => a - b);
    selB = (selB || []).slice().sort((a, b) => a - b);
    const anySel = selF.length || selB.length;
    if (!anySel) return { count: 0, hits: [], nexts: [], nextStats: null, selF, selB };
    const selFSet = new Set(selF), selBSet = new Set(selB);
    const fzoneSel = [[], [], [], [], []];
    selF.forEach((n) => fzoneSel[fzoneOf(n)].push(n));

    const checkF = fMode === 'exact'
      ? (d) => {
        const zones = fzoneCounts(d);
        for (let z = 0; z < 5; z++) {
          if (!fzoneSel[z].length) continue;
          if (zones[z] !== fzoneSel[z].length) return false;
          for (const r of d.front) if (fzoneOf(r) === z && !selFSet.has(r)) return false;
        }
        return true;
      }
      : (d) => selF.every((n) => d.front.includes(n));
    const checkB = bMode === 'exact'
      ? (d) => {
        if (selB.length !== d.back.length) return false;
        return selB.every((n) => d.back.includes(n));
      }
      : (d) => selB.every((n) => d.back.includes(n));

    const isHit = (d) => (!selF.length || checkF(d)) && (!selB.length || checkB(d));
    const hits = [];
    for (let i = 0; i < draws.length; i++) {
      if (!isHit(draws[i])) continue;
      const next = i + 1 < draws.length ? draws[i + 1] : null;
      hits.push(pick(draws[i], next, draws[i - 1] || null));
    }
    const nexts = hits.filter((h) => h.next).map((h) => h.next);
    return {
      count: hits.length, selF, selB, hits, nexts,
      nextStats: nexts.length ? analyzeNexts(hits) : null,
      skippedNoNext: hits.length - nexts.length,
    };
  }

  function pick(d, next, prev) {
    return {
      issue: d.issue, date: d.date, front: d.front, back: d.back,
      sum: fsumOf(d), backsum: backsumOf(d), foe: foeOf(d),
      zoneCounts: fzoneCounts(d), fspan: fspanOf(d),
      fconsec: fconsecOf(d), frepeats: frepeatsOf(d, prev), brepeats: brepeatsOf(d, prev),
      next: next ? nextPick(next, d) : null,
    };
  }
  function nextPick(next, hitDraw) {
    return {
      issue: next.issue, date: next.date, front: next.front, back: next.back,
      sum: fsumOf(next), backsum: backsumOf(next), foe: foeOf(next),
      zoneCounts: fzoneCounts(next), fspan: fspanOf(next),
      fconsec: fconsecOf(next), brepeats: brepeatsOf(next, hitDraw),
    };
  }

  // ===== 命中下期汇总 =====
  function analyzeNexts(hits) {
    const nexts = hits.filter((h) => h.next).map((h) => h.next);
    const n = nexts.length;
    if (!n) return null;
    const fFreq = {}; const bFreq = {}; const zoneDist = { 0: {}, 1: {}, 2: {}, 3: {}, 4: {} };
    const sumBuckets = {};     const foeDist = {}; const spanDist = {};
    let fconsecCnt = 0; let freqRep = 0; let freqRepNums = {}; let bRepCnt = 0; let bRepNums = {};
    let sumTotal = 0;
    nexts.forEach((d) => {
      d.front.forEach((r) => { fFreq[r] = (fFreq[r] || 0) + 1; });
      d.back.forEach((r) => { bFreq[r] = (bFreq[r] || 0) + 1; });
      d.zoneCounts.forEach((c, z) => { zoneDist[z][c] = (zoneDist[z][c] || 0) + 1; });
      sumTotal += d.sum;
      const sb = sumBucket(d.sum); sumBuckets[sb] = (sumBuckets[sb] || 0) + 1;
      foeDist[d.foe] = (foeDist[d.foe] || 0) + 1;
      spanDist[d.fspan] = (spanDist[d.fspan] || 0) + 1;
      if (d.fconsec.length) fconsecCnt++;
      if (d.frepeats && d.frepeats.length) { freqRep++; d.frepeats.forEach((r) => { freqRepNums[r] = (freqRepNums[r] || 0) + 1; }); }
      if (d.brepeats && d.brepeats.length) { bRepCnt++; d.brepeats.forEach((r) => { bRepNums[r] = (bRepNums[r] || 0) + 1; }); }
    });
    const top = (obj, k) => Object.entries(obj).map(([v, c]) => [isNaN(+v) ? v : +v, c]).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, k);
    return {
      total: n, avgSum: +(sumTotal / n).toFixed(1),
      fTop: top(fFreq, 12), bTop: top(bFreq, 8),
      zoneDist: {
        一区: top(zoneDist[0], 6), 二区: top(zoneDist[1], 6), 三区: top(zoneDist[2], 6),
        四区: top(zoneDist[3], 6), 五区: top(zoneDist[4], 6),
      },
      sumBuckets: top(sumBuckets, 99).sort((a, b) => a[0] - b[0]),
      foeTop: top(foeDist, 7), spanTop: top(spanDist, 8).sort((a, b) => a[0] - b[0]),
      fconsecRate: +(fconsecCnt / n * 100).toFixed(1),
      freqRepRate: +(freqRep / n * 100).toFixed(1),
      bRepRate: +(bRepCnt / n * 100).toFixed(1),
      freqRepNumsTop: top(freqRepNums, 8), bRepNumsTop: top(bRepNums, 8),
    };
  }

  function sumBucket(s) {
    if (s < 60) return '≤59';
    if (s < 70) return '60-69';
    if (s < 80) return '70-79';
    if (s < 90) return '80-89';
    if (s < 100) return '90-99';
    if (s < 110) return '100-109';
    if (s < 120) return '110-119';
    if (s < 130) return '120-129';
    if (s < 140) return '130-139';
    return '≥140';
  }
  const SUM_ORDER = ['≤59', '60-69', '70-79', '80-89', '90-99', '100-109', '110-119', '120-129', '130-139', '≥140'];

  // ===== 基本统计 =====
  function basicStats(draws) {
    const n = draws.length;
    if (!n) return null;
    let two = 0, three = 0, fourPlus = 0, noConsec = 0;
    let freqRepIssues = 0, freqRepNums = 0;
    const foeDist = {}, fbsDist = {}, sumArr = [], spanDist = {}, bsumArr = [];
    const sumBuckets = {};
    draws.forEach((d, i) => {
      const cg = fconsecOf(d);
      if (!cg.length) noConsec++;
      const maxLen = cg.length ? Math.max(...cg.map((g) => g.length)) : 1;
      if (maxLen >= 4) fourPlus++; else if (maxLen === 3) three++; else if (maxLen === 2) two++;
      const fr = frepeatsOf(d, draws[i - 1]);
      if (i > 0 && fr.length) { freqRepIssues++; freqRepNums += fr.length; }
      const oe = foeOf(d); foeDist[oe] = (foeDist[oe] || 0) + 1;
      const bs = fbsOf(d); fbsDist[bs] = (fbsDist[bs] || 0) + 1;
      const s = fsumOf(d); sumArr.push(s); sumBuckets[sumBucket(s)] = (sumBuckets[sumBucket(s)] || 0) + 1;
      spanDist[fspanOf(d)] = (spanDist[fspanOf(d)] || 0) + 1;
      bsumArr.push(backsumOf(d));
    });
    sumArr.sort((a, b) => a - b); bsumArr.sort((a, b) => a - b);
    const pct = (x) => +(x / n * 100).toFixed(1);
    const median = (arr) => arr.length % 2 ? arr[(arr.length - 1) / 2] : +((arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2).toFixed(1);
    return {
      count: n,
      range: { first: draws[0].issue, last: draws[n - 1].issue },
      fconsec: { none: [noConsec, pct(noConsec)], two: [two, pct(two)], three: [three, pct(three)], fourPlus: [fourPlus, pct(fourPlus)], rate: +((n - noConsec) / n * 100).toFixed(1) },
      freqRep: { issues: [freqRepIssues, pct(freqRepIssues)], avgNums: +(freqRepNums / Math.max(1, freqRepIssues)).toFixed(2), rate: +(freqRepIssues / Math.max(1, n - 1) * 100).toFixed(1) },
      foe: sortEntries(foeDist), fbs: sortEntries(fbsDist),
      sum: { min: sumArr[0], max: sumArr[n - 1], avg: +(sumArr.reduce((a, b) => a + b, 0) / n).toFixed(1), median: median(sumArr), buckets: SUM_ORDER.map((k) => [k, sumBuckets[k] || 0]) },
      bsum: { min: bsumArr[0], max: bsumArr[n - 1], avg: +(bsumArr.reduce((a, b) => a + b, 0) / n).toFixed(1), median: median(bsumArr) },
      span: Object.entries(spanDist).map(([v, c]) => [+v, c]).sort((a, b) => a[0] - b[0]),
    };
  }
  function sortEntries(obj) { return Object.entries(obj).map(([k, v]) => [k, v]).sort((a, b) => b[1] - a[1]); }

  // ===== 前区走势（频率/遗漏/冷热） =====
  function frontTrend(draws) {
    const freq = {}, lastIdx = {}, maxMiss = {};
    for (let i = 0; i < draws.length; i++) for (const r of draws[i].front) {
      freq[r] = (freq[r] || 0) + 1;
      if (lastIdx[r] !== undefined) { const gap = i - lastIdx[r] - 1; if (gap > (maxMiss[r] || 0)) maxMiss[r] = gap; }
      lastIdx[r] = i;
    }
    const curMiss = {};
    for (let nn = 1; nn <= FNUM; nn++) {
      let m = 0;
      for (let i = draws.length - 1; i >= 0; i--) { if (draws[i].front.includes(nn)) break; m++; }
      curMiss[nn] = m;
    }
    const rows = [];
    for (let nn = 1; nn <= FNUM; nn++) rows.push({
      num: nn, zone: fzoneOf(nn), zoneName: zoneName[fzoneOf(nn)],
      freq: freq[nn] || 0, pct: +((freq[nn] || 0) / draws.length * 100).toFixed(1),
      curMiss: curMiss[nn], maxMiss: maxMiss[nn] || 0,
    });
    const hot = [...rows].sort((a, b) => b.freq - a.freq || a.num - b.num).slice(0, 10);
    const cold = [...rows].sort((a, b) => b.curMiss - a.curMiss || a.num - b.num).slice(0, 10);
    return { rows, hot, cold, total: draws.length, latest: draws[draws.length - 1] };
  }

  // ===== 后区走势（12 号，不分 ABCD） =====
  function backTrend(draws) {
    const freq = {}, maxMiss = {}, lastIdx = {};
    for (let i = 0; i < draws.length; i++) for (const b of draws[i].back) {
      freq[b] = (freq[b] || 0) + 1;
      if (lastIdx[b] !== undefined) { const gap = i - lastIdx[b] - 1; if (gap > (maxMiss[b] || 0)) maxMiss[b] = gap; }
      lastIdx[b] = i;
    }
    const curMiss = {};
    for (let nn = 1; nn <= BNUM; nn++) {
      let m = 0;
      for (let i = draws.length - 1; i >= 0; i--) { if (draws[i].back.includes(nn)) break; m++; }
      curMiss[nn] = m;
    }
    const rows = [];
    for (let nn = 1; nn <= BNUM; nn++) rows.push({
      num: nn, freq: freq[nn] || 0, pct: +((freq[nn] || 0) / draws.length * 100).toFixed(1),
      curMiss: curMiss[nn], maxMiss: maxMiss[nn] || 0,
    });
    const recentFlow = draws.slice(-20).map((d) => ({ issue: d.issue.slice(-3), back: d.back }));
    const latest = draws[draws.length - 1];
    return {
      rows, recentFlow, total: draws.length,
      latest: latest ? { issue: latest.issue, back: latest.back } : null,
      hot: [...rows].sort((a, b) => b.freq - a.freq || a.num - b.num).slice(0, 5),
      cold: [...rows].sort((a, b) => b.curMiss - a.curMiss || a.num - b.num).slice(0, 5),
    };
  }

  // ===== 号码矩阵（浓缩矩阵） =====
  function matrix(draws, N) {
    N = N || 30;
    if (!draws.length) return { rows: [], headers: { front: [], back: [] }, N: 0 };
    const slice = draws.slice(-N);
    const reversed = slice.slice().reverse();
    const rows = reversed.map((d) => {
      const fSet = new Set(d.front), bSet = new Set(d.back);
      return {
        issue: d.issue, date: d.date,
        fCells: d.front.slice().sort((a, b) => a - b).map((n) => ({ num: n, state: 'hit' })),
        bCells: d.back.slice().sort((a, b) => a - b).map((n) => ({ num: n, state: 'hit' })),
      };
    });
    function curMiss(n, type) {
      let m = 0;
      for (let i = draws.length - 1; i >= 0; i--) {
        const hit = type === 'front' ? draws[i].front.includes(n) : draws[i].back.includes(n);
        if (hit) break; m++;
      }
      return m;
    }
    function inSlice(n, type) {
      return slice.reduce((a, d) => a + (type === 'front' ? (d.front.includes(n) ? 1 : 0) : (d.back.includes(n) ? 1 : 0)), 0);
    }
    const frontH = []; for (let nn = 1; nn <= FNUM; nn++) frontH.push({ num: nn, miss: curMiss(nn, 'front'), heat: inSlice(nn, 'front'), label: pad2(nn), zone: fzoneOf(nn) });
    const backH = []; for (let nn = 1; nn <= BNUM; nn++) backH.push({ num: nn, miss: curMiss(nn, 'back'), heat: inSlice(nn, 'back'), label: pad2(nn) });
    return { rows, headers: { front: frontH, back: backH }, N, sliceLen: slice.length };
  }

  // ===== 数字列表矩阵（走势图核心） =====
  function matrixNum(draws, N, filter) {
    N = N || 50;
    const D = ['和值', '跨度', '区间比', '奇偶比'];
    if (!draws.length) return { rows: [], headers: { front: [], back: [], derivs: D }, N, mode: 'all' };
    let work = draws;
    if (filter && filter.weekday !== undefined) work = draws.filter((d) => new Date(d.date).getDay() === filter.weekday);
    if (!work.length) return { rows: [], headers: { front: [], back: [], derivs: D }, N, mode: filter ? 'weekday' : 'all' };
    const slice = work.slice(-N);
    const reversed = slice.slice().reverse();
    function missAt(idx, num, type) {
      let m = 0;
      for (let i = idx; i >= 0; i--) {
        const hit = type === 'front' ? slice[i].front.includes(num) : slice[i].back.includes(num);
        if (hit) break; m++;
      }
      return m;
    }
    function heatIn(num, type) {
      return slice.reduce((a, d) => a + (type === 'front' ? (d.front.includes(num) ? 1 : 0) : (d.back.includes(num) ? 1 : 0)), 0);
    }
    const rows = [];
    reversed.forEach((d, i) => {
      const idx = slice.length - 1 - i;
      const prev = idx > 0 ? slice[idx - 1] : null;
      const frontCells = [];
      for (let nn = 1; nn <= FNUM; nn++) frontCells.push({ num: nn, miss: missAt(idx, nn, 'front'), hit: d.front.includes(nn) });
      const backCells = [];
      for (let nn = 1; nn <= BNUM; nn++) backCells.push({ num: nn, miss: missAt(idx, nn, 'back'), hit: d.back.includes(nn) });
      const zc = fzoneCounts(d);
      const cs = fconsecOf(d);
      const fr = prev ? d.front.filter((r) => prev.front.includes(r)) : [];
      rows.push({
        issue: d.issue, date: d.date, front: d.front, back: d.back, frontCells, backCells,
        derivs: {
          sum: fsumOf(d), span: fspanOf(d), foe: foeOf(d),
          zones: zc.join(':'),
          fconsec: cs.length ? cs.map((g) => g.join('-')).join(' ') : '—',
          frepeats: fr.length ? fr.join(',') : '—',
        },
      });
    });
    const frontH = []; for (let nn = 1; nn <= FNUM; nn++) frontH.push({ num: nn, miss: missAt(slice.length - 1, nn, 'front'), heat: heatIn(nn, 'front'), label: pad2(nn), zone: fzoneOf(nn) });
    const backH = []; for (let nn = 1; nn <= BNUM; nn++) backH.push({ num: nn, miss: missAt(slice.length - 1, nn, 'back'), heat: heatIn(nn, 'back'), label: pad2(nn) });
    return { rows, headers: { front: frontH, back: backH, derivs: D }, N, sliceLen: slice.length, mode: filter ? 'weekday' : 'all' };
  }

  return {
    FZONES, FNUM, BNUM, fzoneOf, zoneName, zoneOf: fzoneOf,
    fsumOf, backsumOf, foeOf, fbsOf, fspanOf, fzoneCounts, fconsecOf, frepeatsOf, brepeatsOf, sumBucket, SUM_ORDER,
    query, basicStats, frontTrend, backTrend, analyzeNexts, matrix, matrixNum, pad2,
  };
});
