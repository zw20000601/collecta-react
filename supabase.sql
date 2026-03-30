-- resources
create extension if not exists pgcrypto;

-- resource categories
create table if not exists public.resource_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  emoji text not null default '📁',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.resource_categories enable row level security;

drop policy if exists resource_categories_public_read on public.resource_categories;
create policy resource_categories_public_read
on public.resource_categories for select
to anon, authenticated
using (is_active = true);

drop policy if exists resource_categories_admin_insert on public.resource_categories;
create policy resource_categories_admin_insert
on public.resource_categories for insert
to authenticated
with check (((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));

drop policy if exists resource_categories_admin_update on public.resource_categories;
create policy resource_categories_admin_update
on public.resource_categories for update
to authenticated
using (((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'))
with check (((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));

drop policy if exists resource_categories_admin_delete on public.resource_categories;
create policy resource_categories_admin_delete
on public.resource_categories for delete
to authenticated
using (((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));

insert into public.resource_categories (name, emoji, sort_order, is_active)
values
  ('文章', '📚', 10, true),
  ('视频', '🎬', 20, true),
  ('工具', '🛠️', 30, true),
  ('设计', '🎨', 40, true),
  ('电子书', '📖', 50, true),
  ('播客', '🎧', 60, true),
  ('笔记', '📝', 70, true),
  ('代码', '💻', 80, true)
on conflict (name) do update
set emoji = excluded.emoji,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    updated_at = now();

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  title text not null,
  url text not null,
  category text,
  cover_url text,
  tags text[] default '{}',
  note text,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.resources add column if not exists cover_url text;

alter table public.resources enable row level security;

drop policy if exists resources_public_read on public.resources;
create policy resources_public_read
on public.resources for select
to anon, authenticated
using (is_public = true or auth.uid() = user_id);

drop policy if exists resources_admin_select_all on public.resources;
create policy resources_admin_select_all
on public.resources for select
to authenticated
using (((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));

drop policy if exists resources_insert_auth on public.resources;
create policy resources_insert_auth
on public.resources for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists resources_update_own on public.resources;
create policy resources_update_own
on public.resources for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists resources_update_admin on public.resources;
create policy resources_update_admin
on public.resources for update
to authenticated
using (((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'))
with check (((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));

drop policy if exists resources_delete_own on public.resources;
create policy resources_delete_own
on public.resources for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists resources_delete_admin on public.resources;
create policy resources_delete_admin
on public.resources for delete
to authenticated
using (((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));

-- favorites
create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, resource_id)
);

alter table public.favorites enable row level security;

drop policy if exists favorites_select_own on public.favorites;
create policy favorites_select_own
on public.favorites for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists favorites_insert_own on public.favorites;
create policy favorites_insert_own
on public.favorites for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists favorites_delete_own on public.favorites;
create policy favorites_delete_own
on public.favorites for delete
to authenticated
using (auth.uid() = user_id);

-- profiles (for admin user management page)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'user',
  status text not null default 'active',
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists role text default 'user';
alter table public.profiles add column if not exists status text default 'active';
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists created_at timestamptz default now();

alter table public.profiles enable row level security;

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin
on public.profiles for select
to authenticated
using (
  auth.uid() = id
  or ((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
);

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin
on public.profiles for update
to authenticated
using (((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'))
with check (((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));

-- messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  content text not null,
  is_done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.messages enable row level security;

drop policy if exists messages_public_read on public.messages;
create policy messages_public_read
on public.messages for select
to anon, authenticated
using (true);

drop policy if exists messages_insert_auth on public.messages;
create policy messages_insert_auth
on public.messages for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists messages_update_admin on public.messages;
create policy messages_update_admin
on public.messages for update
to authenticated
using (((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'))
with check (((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));

drop policy if exists messages_delete_admin on public.messages;
create policy messages_delete_admin
on public.messages for delete
to authenticated
using (((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));

-- =========================================================
-- Message Board V2: posts + votes + replies
-- =========================================================

alter table public.messages add column if not exists title text;
alter table public.messages add column if not exists category text;
alter table public.messages add column if not exists status text;
alter table public.messages add column if not exists vote_count integer not null default 0;
alter table public.messages add column if not exists reply_count integer not null default 0;

update public.messages
set title = left(content, 80)
where (title is null or title = '') and content is not null;

update public.messages
set category = 'other'
where category is null or category = '';

update public.messages
set status = case when is_done = true then 'done' else 'pending' end
where status is null or status = '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_category_check'
  ) then
    alter table public.messages
      add constraint messages_category_check
      check (category in ('resource', 'feature', 'bug', 'other'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_status_check'
  ) then
    alter table public.messages
      add constraint messages_status_check
      check (status in ('pending', 'in_progress', 'done'));
  end if;
end $$;

alter table public.messages alter column category set default 'other';
alter table public.messages alter column status set default 'pending';

create table if not exists public.message_votes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create table if not exists public.message_replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  is_official boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.message_votes enable row level security;
alter table public.message_replies enable row level security;

drop policy if exists message_votes_public_read on public.message_votes;
create policy message_votes_public_read
on public.message_votes for select
to anon, authenticated
using (true);

drop policy if exists message_votes_insert_own on public.message_votes;
create policy message_votes_insert_own
on public.message_votes for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists message_votes_delete_own on public.message_votes;
create policy message_votes_delete_own
on public.message_votes for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists message_replies_public_read on public.message_replies;
create policy message_replies_public_read
on public.message_replies for select
to anon, authenticated
using (true);

drop policy if exists message_replies_insert_auth on public.message_replies;
create policy message_replies_insert_auth
on public.message_replies for insert
to authenticated
with check (
  auth.uid() = user_id
  and (
    is_official = false
    or ((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  )
);

drop policy if exists message_replies_update_admin on public.message_replies;
create policy message_replies_update_admin
on public.message_replies for update
to authenticated
using (((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'))
with check (((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));

drop policy if exists message_replies_delete_admin on public.message_replies;
create policy message_replies_delete_admin
on public.message_replies for delete
to authenticated
using (((auth.jwt() ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'));

create or replace function public.refresh_message_vote_count(target_post_id uuid)
returns void
language sql
as $$
  update public.messages m
  set vote_count = (
    select count(*)::int
    from public.message_votes v
    where v.post_id = target_post_id
  )
  where m.id = target_post_id;
$$;

create or replace function public.refresh_message_reply_count(target_post_id uuid)
returns void
language sql
as $$
  update public.messages m
  set reply_count = (
    select count(*)::int
    from public.message_replies r
    where r.post_id = target_post_id
  )
  where m.id = target_post_id;
$$;

create or replace function public.handle_message_votes_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_message_vote_count(old.post_id);
    return old;
  else
    perform public.refresh_message_vote_count(new.post_id);
    return new;
  end if;
end;
$$;

create or replace function public.handle_message_replies_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_message_reply_count(old.post_id);
    return old;
  else
    perform public.refresh_message_reply_count(new.post_id);
    return new;
  end if;
end;
$$;

drop trigger if exists trg_message_votes_after_insert on public.message_votes;
drop trigger if exists trg_message_votes_after_delete on public.message_votes;
create trigger trg_message_votes_after_insert
after insert on public.message_votes
for each row execute procedure public.handle_message_votes_change();
create trigger trg_message_votes_after_delete
after delete on public.message_votes
for each row execute procedure public.handle_message_votes_change();

drop trigger if exists trg_message_replies_after_insert on public.message_replies;
drop trigger if exists trg_message_replies_after_delete on public.message_replies;
create trigger trg_message_replies_after_insert
after insert on public.message_replies
for each row execute procedure public.handle_message_replies_change();
create trigger trg_message_replies_after_delete
after delete on public.message_replies
for each row execute procedure public.handle_message_replies_change();

-- =========================================================
-- Daily Priority for Message Board (yesterday top votes first)
-- 每天早上按“前一天投票数”更新优先级
-- =========================================================

alter table public.messages add column if not exists yesterday_vote_count integer not null default 0;
alter table public.messages add column if not exists priority_date date;

create index if not exists idx_messages_priority_order
  on public.messages (yesterday_vote_count desc, created_at desc);

create index if not exists idx_message_votes_created_at
  on public.message_votes (created_at);

create or replace function public.refresh_messages_daily_priority(
  target_day date default ((now() at time zone 'Asia/Shanghai')::date - 1)
)
returns void
language sql
as $$
  update public.messages m
  set yesterday_vote_count = coalesce(v.cnt, 0),
      priority_date = target_day
  from (
    select mv.post_id, count(*)::int as cnt
    from public.message_votes mv
    where (mv.created_at at time zone 'Asia/Shanghai')::date = target_day
    group by mv.post_id
  ) v
  where m.id = v.post_id;

  update public.messages m
  set yesterday_vote_count = 0,
      priority_date = target_day
  where not exists (
    select 1
    from public.message_votes mv
    where mv.post_id = m.id
      and (mv.created_at at time zone 'Asia/Shanghai')::date = target_day
  );
$$;

-- 先手动执行一次，立即生成昨日优先级
select public.refresh_messages_daily_priority();

-- 自动任务：UTC 00:00 = 北京时间 08:00
-- 若环境不支持 pg_cron，会自动跳过并给出 notice，不影响其余 SQL。
do $block$
declare
  job_id bigint;
begin
  execute 'create extension if not exists pg_cron';

  for job_id in
    select j.jobid from cron.job j where j.jobname = 'messages_daily_priority_8am_cst'
  loop
    perform cron.unschedule(job_id);
  end loop;

  perform cron.schedule(
    'messages_daily_priority_8am_cst',
    '0 0 * * *',
    $job$select public.refresh_messages_daily_priority();$job$
  );
exception
  when others then
    raise notice 'pg_cron schedule skipped: %', sqlerrm;
end;
$block$;
