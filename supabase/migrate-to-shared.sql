-- ============================================================================
-- 迁移脚本：改成「共享同一份公司账」+ 加「是否意外」标记
-- ----------------------------------------------------------------------------
-- 什么时候跑：你已经跑过 schema.sql、想升级到“老板+财务共管一份账”时，
--   在 Supabase → SQL Editor → New query 里粘贴这整个文件，点 Run（跑一次即可）。
--
-- 这个脚本做两件事：
--   1. 给 entries 表加一列 is_unexpected（是否意外项），默认 false（=规划项）
--   2. 把安全规则(RLS)从“每人只看自己的”改成“所有登录用户共享同一份”
--      —— 注意：RLS 仍然【开着】，只是策略从“自己的行”放宽成“登录即可读写”。
--      适合只有你和财务几个人用的小团队。
--
-- 你已经导入的 7 月数据不会丢；这里只改结构和权限，不动数据。
-- 脚本可重复运行。
-- ============================================================================

-- 1) 加“是否意外项”这一列（false=月初规划好的；true=临时意外的）
alter table public.entries
  add column if not exists is_unexpected boolean not null default false;

-- 2) 换成“共享”策略 --------------------------------------------------------
--    做法：把原来“auth.uid() = user_id（只看自己）”的策略删掉，
--    换成“auth.uid() is not null（只要登录了就能读写全部）”。

-- ---------- months ----------
drop policy if exists "months_select_own" on public.months;
drop policy if exists "months_insert_own" on public.months;
drop policy if exists "months_update_own" on public.months;
drop policy if exists "months_delete_own" on public.months;

drop policy if exists "months_shared_select" on public.months;
create policy "months_shared_select" on public.months
  for select using (auth.uid() is not null);
drop policy if exists "months_shared_insert" on public.months;
create policy "months_shared_insert" on public.months
  for insert with check (auth.uid() is not null);
drop policy if exists "months_shared_update" on public.months;
create policy "months_shared_update" on public.months
  for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "months_shared_delete" on public.months;
create policy "months_shared_delete" on public.months
  for delete using (auth.uid() is not null);

-- ---------- entries ----------
drop policy if exists "entries_select_own" on public.entries;
drop policy if exists "entries_insert_own" on public.entries;
drop policy if exists "entries_update_own" on public.entries;
drop policy if exists "entries_delete_own" on public.entries;

drop policy if exists "entries_shared_select" on public.entries;
create policy "entries_shared_select" on public.entries
  for select using (auth.uid() is not null);
drop policy if exists "entries_shared_insert" on public.entries;
create policy "entries_shared_insert" on public.entries
  for insert with check (auth.uid() is not null);
drop policy if exists "entries_shared_update" on public.entries;
create policy "entries_shared_update" on public.entries
  for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "entries_shared_delete" on public.entries;
create policy "entries_shared_delete" on public.entries
  for delete using (auth.uid() is not null);

-- ---------- recurring_templates ----------
drop policy if exists "templates_select_own" on public.recurring_templates;
drop policy if exists "templates_insert_own" on public.recurring_templates;
drop policy if exists "templates_update_own" on public.recurring_templates;
drop policy if exists "templates_delete_own" on public.recurring_templates;

drop policy if exists "templates_shared_select" on public.recurring_templates;
create policy "templates_shared_select" on public.recurring_templates
  for select using (auth.uid() is not null);
drop policy if exists "templates_shared_insert" on public.recurring_templates;
create policy "templates_shared_insert" on public.recurring_templates
  for insert with check (auth.uid() is not null);
drop policy if exists "templates_shared_update" on public.recurring_templates;
create policy "templates_shared_update" on public.recurring_templates
  for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "templates_shared_delete" on public.recurring_templates;
create policy "templates_shared_delete" on public.recurring_templates
  for delete using (auth.uid() is not null);

-- ============================================================================
-- 完成！现在所有登录用户共享同一份数据（老板 + 财务看到同一份账），
-- entries 也多了 is_unexpected 列。RLS 依然开着（未登录仍读不到任何东西）。
-- ============================================================================
