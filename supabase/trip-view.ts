// Supabase Edge Function: trip-view
// 보기 전용 링크(가족 등): 편집 링크의 여행 id를 드러내지 않는 '보기 표'(v)를 만들고, 그 표로 일정만 읽게 한다.
// 표 = 여행 id를 서버만 아는 열쇠로 암호화(AES-GCM)한 것. 표를 가진 사람은 id를 알아낼 수 없으니 고칠 수도 없다.
// 정산·준비물은 보기 전용에 보내지 않는다. Verify JWT는 꺼야 함(앱은 publishable 키로 부름 — JWT가 아님).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

// 열쇠: 서버에만 있는 값에서 만든다(따로 VIEW_SECRET을 두면 그것을 먼저 씀)
let keyP: Promise<CryptoKey> | null = null;
function key() {
  if (!keyP) {
    const base = Deno.env.get('VIEW_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_DB_URL') || '';
    if (!base) throw new Error('NO_SECRET');
    keyP = crypto.subtle.digest('SHA-256', new TextEncoder().encode('trip-view:v1:' + base))
      .then(h => crypto.subtle.importKey('raw', h, 'AES-GCM', false, ['encrypt', 'decrypt']));
  }
  return keyP;
}
async function mint(tid: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), new TextEncoder().encode(tid)));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64u(out);
}
async function unseal(v: string) {
  if (!/^[A-Za-z0-9_-]{40,160}$/.test(v)) return null;
  try {
    const u = unb64u(v);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, await key(), u.slice(12));
    const tid = new TextDecoder().decode(pt);
    return ID_RE.test(tid) ? tid : null;
  } catch { return null; }
}
// 여행 읽기는 앱과 같은 공개 함수(trip_get·trip_rev)를 부른 쪽의 공개 키로
async function rpc(fn: string, args: unknown, apikey: string) {
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('DB ' + r.status);
  return r.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST_ONLY' }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: 'BAD_JSON' }, 400); }
  const apikey = req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  try {
    if (b.action === 'mint') {   // 편집 id를 아는 사람(= 편집할 수 있는 사람)만 보기 표를 만들 수 있음
      const tid = String(b.tid || '');
      if (!ID_RE.test(tid)) return json({ error: 'BAD_ID' }, 400);
      if (await rpc('trip_rev', { p_id: tid }, apikey) == null) return json({ error: 'NOT_FOUND' }, 404);
      return json({ v: await mint(tid) });
    }
    const tid = await unseal(String(b.v || ''));
    if (!tid) return json({ error: 'BAD_VIEW' }, 400);
    if (b.action === 'rev') {
      const rev = await rpc('trip_rev', { p_id: tid }, apikey);
      return rev == null ? json({ error: 'NOT_FOUND' }, 404) : json({ rev });
    }
    if (b.action === 'get') {
      const r = await rpc('trip_get', { p_id: tid }, apikey);
      if (!r || typeof r !== 'object' || !r.data) return json({ error: 'NOT_FOUND' }, 404);
      const d = r.data as Record<string, unknown>;
      delete d.expenses; delete d.todos;   // 정산·준비물은 일행끼리만
      return json({ data: d, rev: r.rev });
    }
    return json({ error: 'BAD_ACTION' }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
