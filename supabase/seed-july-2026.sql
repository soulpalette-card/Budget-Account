-- ============================================================================
-- 一次性把 2026 年 7 月那 12 笔现金流塞进数据库（作为参考数据）
-- ----------------------------------------------------------------------------
-- 怎么用：Supabase → SQL Editor → New query → 粘贴本文件 → Run。跑一次即可。
-- 这个脚本会：
--   1.（保险）确保 entries 有 is_unexpected 这一列
--   2. 找一个用户 id（用最早注册的那个账号，通常就是你）
--   3. 复用已有的 "2026-07" 账户；没有就新建一个
--   4. 把 12 笔账写进去（都当“规划项 + 已实现”，方便你直接对照参考）
--
-- 金额都是 numeric(14,2)。BALANCE CASH 当作一笔“收入”，这样累计余额从它开始。
-- ============================================================================

-- 1) 保险：确保有 is_unexpected 列（跑过 migrate-to-shared.sql 的话这步没影响）
alter table public.entries
  add column if not exists is_unexpected boolean not null default false;

-- 2~4) 用一个代码块完成：找用户 → 复用/新建月份 → 插入 12 笔
do $$
declare
  v_uid   uuid;
  v_month uuid;
begin
  -- 取最早注册的用户（一般就是你本人）
  select id into v_uid from auth.users order by created_at asc limit 1;
  if v_uid is null then
    raise exception '还没有任何注册用户，请先在网页上注册登录一次，再回来跑这个脚本。';
  end if;

  -- 复用已有的 2026-07 账户；没有才新建
  select id into v_month from public.months where label = '2026-07' order by created_at asc limit 1;
  if v_month is null then
    insert into public.months (user_id, label, sort_order, opening_balance)
    values (v_uid, '2026-07', 0, 0)
    returning id into v_month;
  end if;

  -- 12 笔（zone: income=收入 / expense=支出；settled=true 表示已实现）
  insert into public.entries
    (user_id, month_id, zone, entry_date, amount, description, confidence, settled, is_unexpected)
  values
    (v_uid, v_month, 'income',  '2026-07-08', 15000.00, 'BALANCE CASH',              'Confirmed', true, false),
    (v_uid, v_month, 'income',  '2026-07-10', 42972.85, 'KSL PC 1 <22/5/26>',        'Confirmed', true, false),
    (v_uid, v_month, 'expense', '2026-07-15', 16000.00, 'HARDWARE',                  null,        true, false),
    (v_uid, v_month, 'expense', '2026-07-15', 15570.00, 'EPF',                       null,        true, false),
    (v_uid, v_month, 'expense', '2026-07-15', 26000.00, 'subcon-ksl <22/6/26>',      null,        true, false),
    (v_uid, v_month, 'expense', '2026-07-15',  5000.00, 'EHSAN',                     null,        true, false),
    (v_uid, v_month, 'expense', '2026-07-15', 10152.00, 'EPF/PCB/SOCSO',             null,        true, false),
    (v_uid, v_month, 'expense', '2026-07-29',  5000.00, 'LOAN INTEREST',             null,        true, false),
    (v_uid, v_month, 'expense', '2026-07-29',  2000.00, 'Hardware',                  null,        true, false),
    (v_uid, v_month, 'expense', '2026-07-29',  3000.00, 'ot',                        null,        true, false),
    (v_uid, v_month, 'expense', '2026-07-31',  9150.00, 'OFFICE EXPENSES + MACHINE', null,        true, false),
    (v_uid, v_month, 'income',  '2026-07-31', 30000.00, 'new loan',                  'Confirmed', true, false);

  raise notice '完成：已把 12 笔 7 月数据写入账户 2026-07。';
end $$;
