-- ============================================================================
-- UNIKOYO 现金流预算 —— 数据库建表脚本（在 Supabase 里运行这个）
-- ----------------------------------------------------------------------------
-- 怎么用：
--   1. 打开 Supabase 后台 → 你的项目 → 左边 SQL Editor（SQL 编辑器）
--   2. 点 "New query"，把这整个文件的内容粘进去
--   3. 点 "Run" 运行。看到成功就建好了。
--
-- 这个脚本做了三件事：
--   A. 建三张表：months / entries / recurring_templates
--   B. 每张表都开启 RLS（行级安全）—— 保证每个用户只能看到自己的数据
--   C. 加安全策略：只允许操作 user_id = 自己 的那些行
--
-- 铁律：金额一律用 numeric(14,2)（两位小数），不用普通浮点，避免误差。
-- 这个脚本可以重复运行（用了 if not exists / drop policy if exists）。
-- ============================================================================

-- ============ 表 1：months（月份）============
-- 一个月一行。记录这个月的名字、排序、期初余额。
create table if not exists public.months (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  label           text not null,                       -- 月份名字，例如 "2026-07"
  sort_order      integer not null default 0,          -- 排序序号，越小越靠前
  opening_balance numeric(14,2) not null default 0,    -- 期初余额（两位小数）
  created_at      timestamptz not null default now()
);

-- ============ 表 2：entries（每一笔收入/支出/突发）============
-- zone 决定它属于哪个区块：income 收入 / expense 支出 / unexpected 突发。
create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  month_id    uuid not null references public.months (id) on delete cascade,
  zone        text not null check (zone in ('income', 'expense', 'unexpected')),
  entry_date  date,                                     -- 这笔钱的日期（可空）
  amount      numeric(14,2) not null default 0,         -- 金额（两位小数，核心！）
  category    text,                                     -- 分类
  description text,                                     -- 说明
  confidence  text check (confidence in ('Confirmed', 'Likely', 'Tentative')),
  settled     boolean not null default false,           -- 是否已结清/落地
  note        text,                                     -- 备注
  is_deleted  boolean not null default false,           -- 软删除标记（true=已删可恢复）
  created_at  timestamptz not null default now()
);

-- 给常用查询加索引，数据多了也快
create index if not exists entries_month_id_idx on public.entries (month_id);
create index if not exists entries_user_id_idx on public.entries (user_id);

-- ============ 表 3：recurring_templates（重复项目模板）============
-- 每月都会出现的固定项目（房租、薪资等），新建月份时可以一键带入。
create table if not exists public.recurring_templates (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('income', 'expense')),
  amount       numeric(14,2) not null default 0,        -- 金额（两位小数）
  category     text,
  description  text,
  day_of_month integer check (day_of_month between 1 and 31)  -- 每月几号（备注用）
);

-- ============================================================================
-- 开启 RLS（Row Level Security 行级安全）—— 【绝不能关】
-- 开了之后，默认谁都读不了。下面再加策略，只放行“自己的行”。
-- ============================================================================
alter table public.months enable row level security;
alter table public.entries enable row level security;
alter table public.recurring_templates enable row level security;

-- ---------- months 的安全策略 ----------
-- 说明：auth.uid() 是 Supabase 提供的“当前登录用户 id”。
-- 每条策略都要求 user_id = auth.uid()，也就是“只能碰自己的行”。
drop policy if exists "months_select_own" on public.months;
create policy "months_select_own" on public.months
  for select using (auth.uid() = user_id);

drop policy if exists "months_insert_own" on public.months;
create policy "months_insert_own" on public.months
  for insert with check (auth.uid() = user_id);

drop policy if exists "months_update_own" on public.months;
create policy "months_update_own" on public.months
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "months_delete_own" on public.months;
create policy "months_delete_own" on public.months
  for delete using (auth.uid() = user_id);

-- ---------- entries 的安全策略 ----------
drop policy if exists "entries_select_own" on public.entries;
create policy "entries_select_own" on public.entries
  for select using (auth.uid() = user_id);

drop policy if exists "entries_insert_own" on public.entries;
create policy "entries_insert_own" on public.entries
  for insert with check (auth.uid() = user_id);

drop policy if exists "entries_update_own" on public.entries;
create policy "entries_update_own" on public.entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "entries_delete_own" on public.entries;
create policy "entries_delete_own" on public.entries
  for delete using (auth.uid() = user_id);

-- ---------- recurring_templates 的安全策略 ----------
drop policy if exists "templates_select_own" on public.recurring_templates;
create policy "templates_select_own" on public.recurring_templates
  for select using (auth.uid() = user_id);

drop policy if exists "templates_insert_own" on public.recurring_templates;
create policy "templates_insert_own" on public.recurring_templates
  for insert with check (auth.uid() = user_id);

drop policy if exists "templates_update_own" on public.recurring_templates;
create policy "templates_update_own" on public.recurring_templates
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "templates_delete_own" on public.recurring_templates;
create policy "templates_delete_own" on public.recurring_templates
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- 完成！现在三张表都建好、RLS 都开好、策略都加好了。
-- 每个用户登录后，只能读写自己的数据，互相看不见。
-- ============================================================================
