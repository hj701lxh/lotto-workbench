// functions/api/draws.js — GET /api/draws?lotto=ssq|dlt
// 返回快照全量 + 500彩票网最新增量合并后的完整数据
import { fetchAndParse, loadSnapshot, mergeDraws, jsonResp, detectLotto } from './_500com.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const lotto = detectLotto(request);

  try {
    const [fresh, snap] = await Promise.all([
      fetchAndParse(lotto),
      loadSnapshot(env, lotto).catch(() => null),
    ]);

    let draws = fresh.draws;
    let added = 0;
    if (snap && Array.isArray(snap.draws)) {
      const merged = mergeDraws(snap.draws, fresh.draws);
      draws = merged.draws;
      added = merged.added;
    } else {
      // 快照读不到时降级：仅返回实时抓到的近期数据（倒序→升序）
      draws = fresh.draws.slice().reverse();
      added = draws.length;
    }

    return jsonResp({
      ok: true,
      lotto,
      source: '500彩票网·实时',
      added,
      total: draws.length,
      latestMeta: fresh.meta,
      draws,
    });
  } catch (err) {
    return jsonResp({ ok: false, lotto, error: String(err && err.message || err) }, 502);
  }
}