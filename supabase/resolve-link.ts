// Supabase Edge Function: resolve-link
// 지도 공유 링크(maps.app.goo.gl, naver.me, kko.to …)를 끝까지 따라가 최종 주소와 장소 이름을 돌려준다.
// 브라우저에서는 CORS 때문에 짧은 링크를 풀 수 없어서 서버에서 대신 연다. 지도 서비스 주소만 허용(열린 프록시 방지).
// 구글 도메인은 google.com / google.co.kr / google.com.au 같은 형태만(google.attacker.com 같은 건 막음)
const ALLOW = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|(www\.|maps\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})|naver\.me|(m\.)?map\.naver\.com|(m|pcmap)\.place\.naver\.com|kko\.to|(m\.)?map\.kakao\.com|place\.map\.kakao\.com|applink\.map\.kakao\.com)$/i;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const meta = (html: string, prop: string) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i');
  return (html.match(re) || html.match(re2) || [])[1] || '';
};
const unesc = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function get(url: string) {
  const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  return r;
}

// 구글 지도 '저장한 장소 목록' 공유 링크: 주소 안의 목록 번호(placelists/list/ID 또는 data=…!11m2!2sID)로 목록 전체를 읽는다.
// 공유를 켠 목록만 읽힌다. 목록 주인 이름·사진 같은 개인 정보는 돌려주지 않는다.
const LIST_RE = /(?:placelists\/list\/|!11m\d+!2s)([A-Za-z0-9_-]{16,64})/;
const listId = (s: string) => { let x = s; try { x = decodeURIComponent(s); } catch { /* 그대로 */ } return (x.match(LIST_RE) || [])[1] || ''; };
const cidOf = (s: unknown) => { try { const n = BigInt(String(s)); return (n < 0n ? n + (1n << 64n) : n).toString(); } catch { return ''; } };
async function getList(id: string) {
  const r = await fetch(`https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=ko&gl=kr&pb=!1m4!1s${id}!2e1!3m1!1e1!2e2!3e2!4i500!16b1`,
    { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  if (!r.ok) { await r.body?.cancel(); throw new Error('LIST_PRIVATE'); }
  const t = (await r.text()).slice(0, 4000000);
  let L: any = null;
  try { L = JSON.parse(t.slice(t.indexOf('\n') + 1))?.[0]; } catch { L = null; }
  if (!Array.isArray(L)) throw new Error('LIST_PRIVATE');
  const items: Record<string, unknown>[] = [];
  for (const it of (Array.isArray(L[8]) ? L[8] : [])) {
    const loc = Array.isArray(it?.[1]) ? it[1] : [], c = Array.isArray(loc[5]) ? loc[5] : [];
    const lat = Number(c[2]), lng = Number(c[3]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const cid = cidOf(Array.isArray(loc[6]) ? loc[6][1] : '');
    items.push({ name: String(it?.[2] || '').slice(0, 120), addr: String(loc[4] || '').slice(0, 300), note: String(it?.[3] || '').slice(0, 1000), lat, lng, gmaps: cid ? `https://maps.google.com/?cid=${cid}` : '' });
    if (items.length >= 500) break;
  }
  return { title: String(L[4] || '').slice(0, 120), items };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    let u = new URL(String(body.url || ''));
    let html = '';
    for (let i = 0; i < 8; i++) {
      if (!/^https?:$/.test(u.protocol) || u.port !== '' || !ALLOW.test(u.hostname)) return json({ error: 'HOST_NOT_ALLOWED', url: u.href }, 400);
      if (/google\./i.test(u.hostname) && listId(u.href)) break;   // 목록 주소까지 왔으면 페이지는 열지 않음
      const r = await get(u.href);
      const loc = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && loc) { u = new URL(loc, u); await r.body?.cancel(); continue; }
      if ((r.headers.get('content-type') || '').includes('text/html')) html = (await r.text()).slice(0, 400000);
      else await r.body?.cancel();
      break;
    }
    const lid = /google\./i.test(u.hostname) ? listId(u.href) : '';
    if (lid) {
      const list = await getList(lid);
      return json({ url: u.href, title: list.title, list });
    }
    const out: Record<string, unknown> = { url: u.href, title: unesc(meta(html, 'og:title') || (html.match(/<title>([^<]*)/i) || [])[1] || '').trim() };
    // 구글 지도: 최종 주소 안의 좌표를 돌려주는 경우가 많다. 없으면 페이지 안의 좌표를 찾는다.
    if (/google\./i.test(u.hostname)) {
      const m = html.match(/\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/) || html.match(/center=(-?\d+\.\d+)%2C(-?\d+\.\d+)/);
      if (m) { out.lat = +m[1]; out.lng = +m[2]; }
    }
    // 네이버 지도: 장소 번호로 모바일 장소 페이지를 열어 이름·좌표를 읽는다.
    const nid = u.href.match(/(?:place\/|pinId=|[?&]id=)(\d{5,})/);
    if (nid && /naver\.com$/i.test(u.hostname)) {
      const r = await get(`https://m.place.naver.com/place/${nid[1]}/home`);
      if (r.ok) {
        const h = (await r.text()).slice(0, 600000);
        const t = unesc(meta(h, 'og:title')).replace(/\s*:\s*네이버.*$/, '').trim();
        if (t) out.title = t;
        const x = h.match(/"x":"?(\d{2,3}\.\d+)"?,\s*"y":"?(\d{1,2}\.\d+)"?/);
        if (x) { out.lng = +x[1]; out.lat = +x[2]; }
        const a = h.match(/"roadAddress":"([^"]+)"/) || h.match(/"address":"([^"]+)"/);
        if (a) out.addr = a[1];
      } else await r.body?.cancel();
    }
    // 카카오맵: 장소 번호로 장소 정보(JSON)를 읽는다 — 이름·좌표(WGS84)·주소·분류.
    const kid = u.href.match(/place\.map\.kakao\.com\/(?:m\/)?(\d{4,})/) || (/kakao\.com$/i.test(u.hostname) ? u.href.match(/[?&](?:id|itemId|confirmid)=(\d{4,})/) : null);
    if (kid) {
      const r = await fetch(`https://place-api.map.kakao.com/places/panel3/${kid[1]}`, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': UA, 'pf': 'web', 'Referer': 'https://place.map.kakao.com/' } }).catch(() => null);
      if (r && r.ok) {
        const j = await r.json().catch(() => null);
        const sm = j?.summary;
        if (sm?.name) out.title = sm.name;
        if (Number.isFinite(sm?.point?.lat) && Number.isFinite(sm?.point?.lon)) { out.lat = sm.point.lat; out.lng = sm.point.lon; }
        if (sm?.address?.disp) out.addr = sm.address.disp;
        const c1 = String(sm?.category?.name1 || '') + ' ' + String(sm?.category?.name2 || '');
        out.cat = /카페|디저트|간식|베이커리/.test(c1) ? 'cafe' : /음식|식당/.test(c1) ? 'food' : /숙박|호텔/.test(c1) ? 'stay' : /관광|명소|여행|문화|공원/.test(c1) ? 'sight' : /쇼핑|시장|백화점|마트/.test(c1) ? 'shop' : /교통|역/.test(c1) ? 'move' : undefined;
      } else await r?.body?.cancel();
    }
    if (typeof out.title === 'string') out.title = out.title.replace(/\s*[-–|]\s*(Google 지도|Google Maps|네이버 지도|카카오맵)\s*$/i, '').trim();
    return json(out);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 400);
  }
});
