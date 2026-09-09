// functions/api/latest.js — GET /api/latest?lotto=ssq|dlt
// 返回最新一期的奖池/销量/一二等奖信息
import { fetchAndParse, jsonResp, detectLotto } from './_500com.js';

export async function onRequestGet(context) {
  const { request } = context;
  const lotto = detectLotto(request);

  try {
    const fresh = await fetchAndParse(lotto);
    return jsonResp({ ok: true, lotto, meta: fresh.meta });
  } catch (err) {
    return jsonResp({ ok: false, lotto, error: String(err && err.message || err) }, 502);
  }
}