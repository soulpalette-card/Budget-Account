-- ============================================================================
-- 新增「项目 Projects」维度：每一笔账可以归到 Office(办公室) 或某个项目
-- ----------------------------------------------------------------------------
-- Supabase → SQL Editor → New query → 粘贴 → Run。跑一次即可，可重复跑。
--   · projects 表：一行 = 一个项目（如 KSL、Seputeh），可停用。
--   · entries 加 project_id：空 = Office(公司整体开支)；有值 = 归到那个项目。
-- 数据全公司共享（登录用户看同一份）。
-- ============================================================================

create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,                       -- 项目名称
  active     boolean not null default true,       -- 在用 / 停用
  sort_order integer not null default 0,           -- 排序
  created_at timestamptz not null default now()
);

-- 每一笔账归属哪个项目（空 = Office 办公室开支）
alter table public.entries
  add column if not exists project_id uuid references public.projects (id) on delete set null;

create index if not exists entries_project_idx on public.entries (project_id);
create index if not exists projects_sort_idx on public.projects (sort_order);

-- ===== 开启 RLS + 共享策略（登录用户共用同一份，和其它表一致）=====
alter table public.projects enable row level security;

drop policy if exists "projects_shared_select" on public.projects;
create policy "projects_shared_select" on public.projects
  for select using (auth.uid() is not null);

drop policy if exists "projects_shared_insert" on public.projects;
create policy "projects_shared_insert" on public.projects
  for insert with check (auth.uid() is not null);

drop policy if exists "projects_shared_update" on public.projects;
create policy "projects_shared_update" on public.projects
  for update using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "projects_shared_delete" on public.projects;
create policy "projects_shared_delete" on public.projects
  for delete using (auth.uid() is not null);

-- ===== 先建两个项目：KSL、Seputeh（可重复跑，不会重复插入）=====
insert into public.projects (user_id, name, sort_order)
select (select id from auth.users where email = 'flysky0727@gmail.com'), 'KSL', 1
where not exists (select 1 from public.projects where name = 'KSL');

insert into public.projects (user_id, name, sort_order)
select (select id from auth.users where email = 'flysky0727@gmail.com'), 'Seputeh', 2
where not exists (select 1 from public.projects where name = 'Seputeh');
