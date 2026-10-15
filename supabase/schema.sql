-- Run in the Supabase SQL editor as the project administrator.
-- Safe to rerun. Uses Supabase Auth; enable anonymous sign-ins separately.
begin;
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  invite_token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  category text not null default 'light' check (category in ('light', 'wild', 'deep')),
  question_index integer not null default 0 check (question_index >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  closed_at timestamptz
);
create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 20),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists messages_room_time on public.messages(room_id, created_at, id);
create index if not exists members_user on public.room_members(user_id, room_id);
create index if not exists rooms_expiry on public.rooms(expires_at);

create or replace function public.is_room_member(target_room uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.room_members where room_id = target_room and user_id = auth.uid());
$$;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;
drop policy if exists rooms_member_read on public.rooms;
create policy rooms_member_read on public.rooms for select to authenticated using (public.is_room_member(id));
drop policy if exists members_read on public.room_members;
create policy members_read on public.room_members for select to authenticated using (public.is_room_member(room_id));
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using (
  public.is_room_member(room_id) and exists(select 1 from public.rooms r where r.id = room_id and r.closed_at is null and r.expires_at > now())
);
drop policy if exists messages_write on public.messages;
create policy messages_write on public.messages for insert to authenticated with check (
  sender_id = auth.uid() and public.is_room_member(room_id)
);

create or replace function public.create_room(display_name text)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare result public.rooms;
begin
  if auth.uid() is null then raise exception '请先建立匿名身份。'; end if;
  if display_name is null or char_length(btrim(display_name)) not between 1 and 20 then raise exception '昵称需要 1～20 个字。'; end if;
  -- Serialize creation per user so concurrent requests cannot bypass the limit.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if (select count(*) from public.room_members m join public.rooms r on r.id=m.room_id where m.user_id=auth.uid() and r.expires_at>now() and r.closed_at is null) >= 3 then
    raise exception '你已有三个进行中的房间，请先结束一个。';
  end if;
  insert into public.rooms default values returning * into result;
  insert into public.room_members(room_id,user_id,display_name) values(result.id,auth.uid(),btrim(display_name));
  return result;
end;
$$;
create or replace function public.join_room(invitation text, display_name text)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare result public.rooms;
begin
  if auth.uid() is null then raise exception '请先建立匿名身份。'; end if;
  if display_name is null or char_length(btrim(display_name)) not between 1 and 20 then raise exception '昵称需要 1～20 个字。'; end if;
  select * into result from public.rooms where invite_token=invitation for update;
  if not found then raise exception '房间不存在，请检查邀请链接。'; end if;
  if result.closed_at is not null or result.expires_at <= now() then raise exception '房间已结束或过期。'; end if;
  if exists(select 1 from public.room_members where room_id=result.id and user_id=auth.uid()) then return result; end if;
  if (select count(*) from public.room_members where room_id=result.id) >= 2 then raise exception '这个房间已经有两个人啦。'; end if;
  insert into public.room_members(room_id,user_id,display_name) values(result.id,auth.uid(),btrim(display_name));
  return result;
end;
$$;
create or replace function public.advance_question(target_room uuid, expected_index integer, next_category text)
returns void language plpgsql security definer set search_path = '' as $$
declare result public.rooms;
begin
  select * into result from public.rooms where id=target_room for update;
  if not found or not public.is_room_member(target_room) then raise exception '你还没有加入这个房间。'; end if;
  if result.closed_at is not null or result.expires_at<=now() then raise exception '房间已结束或过期。'; end if;
  if next_category is null or next_category not in ('light','wild','deep') then raise exception '未知的问题分类。'; end if;
  -- Compare-and-swap: simultaneous clicks advance only once.
  update public.rooms set question_index=question_index+1,category=next_category where id=target_room and question_index=expected_index;
end;
$$;
create or replace function public.end_room(target_room uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.rooms where id=target_room for update;
  if not public.is_room_member(target_room) then raise exception '你还没有加入这个房间。'; end if;
  update public.rooms set closed_at=coalesce(closed_at,now()) where id=target_room;
  delete from public.messages where room_id=target_room;
end;
$$;
-- The insert and end/join operations lock the same room to avoid lifecycle races.
create or replace function public.check_message_room()
returns trigger language plpgsql security definer set search_path = '' as $$
declare result public.rooms;
begin
  select * into result from public.rooms where id=new.room_id for update;
  if not found or result.closed_at is not null or result.expires_at<=now() then raise exception '房间已结束或过期。'; end if;
  if new.sender_id is distinct from auth.uid() or not public.is_room_member(new.room_id) then raise exception '你还没有加入这个房间。'; end if;
  new.created_at := now();
  new.text := btrim(new.text);
  return new;
end;
$$;
drop trigger if exists message_room_guard on public.messages;
create trigger message_room_guard before insert on public.messages for each row execute function public.check_message_room();

-- Execute only through the admin SQL editor or scheduled cron, never via clients.
create or replace function public.cleanup_expired_rooms()
returns void language sql security definer set search_path = '' as $$
  delete from public.rooms where expires_at <= now() or closed_at <= now() - interval '1 hour';
$$;
revoke all on public.rooms,public.room_members,public.messages from anon,authenticated;
grant select on public.rooms,public.room_members,public.messages to authenticated;
grant insert (id,room_id,sender_id,text) on public.messages to authenticated;
revoke all on function public.is_room_member(uuid), public.create_room(text), public.join_room(text,text), public.advance_question(uuid,integer,text), public.end_room(uuid), public.cleanup_expired_rooms(), public.check_message_room() from public,anon,authenticated;
grant execute on function public.is_room_member(uuid),public.create_room(text),public.join_room(text,text),public.advance_question(uuid,integer,text),public.end_room(uuid) to authenticated;

-- Enable realtime only on the three application tables. Preserve other publications.
do $$
declare tab text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach tab in array array['rooms','room_members','messages'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tab) then
        execute format('alter publication supabase_realtime add table public.%I',tab);
      end if;
    end loop;
  end if;
end;
$$;
commit;
