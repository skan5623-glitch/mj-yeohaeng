-- 여행 플래너 공유 저장소 (Supabase 프로젝트 travel-planner / njhkoqkeyziwbomrritr)
-- 여행 하나 = trips 한 행(data jsonb). 표에는 직접 접근 불가(RLS, 정책 없음) — 아래 함수로만 읽고 쓴다.
-- 여행 id(20자 무작위)를 아는 사람만 그 여행을 읽고 고칠 수 있다(= 공유 링크).

create table if not exists public.trips (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{16,64}$'),
  data jsonb not null default '{}'::jsonb,
  rev bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.trips enable row level security;
revoke all on public.trips from anon, authenticated;

-- 같은 변경 묶음이 두 번 들어와도(응답을 못 받아 다시 보낸 경우) 한 번만 적용하기 위한 기록
create table if not exists public.trip_batches (
  trip_id text not null,
  bid text not null,
  rev bigint not null,
  created_at timestamptz not null default now(),
  primary key (trip_id, bid)
);
alter table public.trip_batches enable row level security;
revoke all on public.trip_batches from anon, authenticated;

create or replace function public.trip_get(p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('data', data, 'rev', rev) from public.trips where id = p_id;
$$;

create or replace function public.trip_rev(p_id text)
returns bigint language sql stable security definer set search_path = public as $$
  select rev from public.trips where id = p_id;
$$;

-- 응답을 못 받아 다시 눌러도 되게: 아직 아무도 고치지 않은(rev 1) 여행이면 새 내용으로 덮어씀
create or replace function public.trip_create(p_id text, p_data jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
begin
  if p_id !~ '^[A-Za-z0-9_-]{16,64}$' then raise exception 'BAD_ID'; end if;
  if jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 2000000 then raise exception 'BAD_DATA'; end if;
  insert into public.trips(id, data) values (p_id, p_data)
  on conflict (id) do update set data = excluded.data, updated_at = now()
    where public.trips.rev = 1;
  if not found then raise exception 'EXISTS'; end if;
  return 1;
end $$;

-- p_ops: [{"p":["places","abc"],"v":{...}}  → 값 설정(중간 경로 자동 생성)
--         {"p":["places","abc"]}            → 삭제]
-- p_bid: 변경 묶음 번호 — 같은 번호가 다시 오면 적용하지 않고 처음 rev 를 돌려준다.
-- 변경마다 rev 가 1 오르고, 실시간 채널 trip-<id> 로 {rev, ops, by} 를 방송한다.
drop function if exists public.trip_patch(text, jsonb, text);
create or replace function public.trip_patch(p_id text, p_ops jsonb, p_by text default null, p_bid text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  d jsonb; o jsonb; path text[]; i int; r bigint; skip boolean;
begin
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 500 then raise exception 'BAD_OPS'; end if;
  if p_bid is not null and length(p_bid) > 64 then raise exception 'BAD_BID'; end if;
  select data into d from public.trips where id = p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_bid is not null then
    select b.rev into r from public.trip_batches b where b.trip_id = p_id and b.bid = p_bid;
    if found then return r; end if;
  end if;
  for o in select value from jsonb_array_elements(p_ops) loop
    if jsonb_typeof(o->'p') <> 'array' then raise exception 'BAD_PATH'; end if;
    select array_agg(x order by n) into path from jsonb_array_elements_text(o->'p') with ordinality as e(x, n);
    if path is null or array_length(path, 1) > 4 then raise exception 'BAD_PATH'; end if;
    if o ? 'v' then
      -- 지워진 장소·사람·지역의 칸만 고치는 변경은 버림(빈 껍데기가 되살아나지 않게)
      skip := array_length(path, 1) > 2 and path[1] in ('places', 'members', 'areas')
              and jsonb_typeof(d #> path[1:2]) is distinct from 'object';
      if not skip then
        for i in 1 .. array_length(path, 1) - 1 loop
          if jsonb_typeof(d #> path[1:i]) is distinct from 'object' then
            d := jsonb_set(d, path[1:i], '{}'::jsonb, true);
          end if;
        end loop;
        d := jsonb_set(d, path, o->'v', true);
      end if;
    else
      d := d #- path;
    end if;
  end loop;
  if pg_column_size(d) > 2000000 then raise exception 'TOO_LARGE'; end if;
  update public.trips set data = d, rev = rev + 1, updated_at = now() where id = p_id returning rev into r;
  if p_bid is not null then
    insert into public.trip_batches(trip_id, bid, rev) values (p_id, p_bid, r) on conflict do nothing;
    delete from public.trip_batches where trip_id = p_id and created_at < now() - interval '3 days';
  end if;
  begin
    perform realtime.send(jsonb_build_object('rev', r, 'ops', p_ops, 'by', p_by), 'patch', 'trip-' || p_id, false);
  exception when others then null;  -- 실시간 방송이 실패해도 저장은 유지(앱이 20초마다 rev 확인)
  end;
  return r;
end $$;

revoke execute on function public.trip_get(text), public.trip_rev(text), public.trip_create(text, jsonb), public.trip_patch(text, jsonb, text, text) from public;
grant execute on function public.trip_get(text), public.trip_rev(text), public.trip_create(text, jsonb), public.trip_patch(text, jsonb, text, text) to anon, authenticated;
