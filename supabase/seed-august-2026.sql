-- ============================================================================
-- 把 2026 年 8 月那 12 笔现金流塞进数据库
-- ----------------------------------------------------------------------------
-- Supabase → SQL Editor → New query → 粘贴本文件 → Run。跑一次即可。
-- 八月的期初不用填：app 会自动接七月的实际余额（-3,899.15）往下累计。
-- 这里 12 笔都当“规划项 + 已实现”，方便直接对照参考。
-- ============================================================================

alter table public.entries
  add column if not exists is_unexpected boolean not null default false;

do $$
declare
  v_uid   uuid;
  v_month uuid;
  v_order integer;
begin
  select id into v_uid from auth.users order by created_at asc limit 1;
  if v_uid is null then
    raise exception '还没有注册用户，请先在网页注册登录一次再跑。';
  end if;

  -- 复用已有的 2026-08；没有就新建（排在最后，保证接在七月后面累计）
  select id into v_month from public.months where label = '2026-08' order by created_at asc limit 1;
  if v_month is null then
    select coalesce(max(sort_order), -1) + 1 into v_order from public.months;
    insert into public.months (user_id, label, sort_order, opening_balance)
    values (v_uid, '2026-08', v_order, 0)
    returning id into v_month;
  end if;

  insert into public.entries
    (user_id, month_id, zone, entry_date, amount, description, confidence, settled, is_unexpected)
  values
    (v_uid, v_month, 'income',  '2026-08-05', 120244.58, 'forcast ksl PC2 <22/6/26>', 'Confirmed', true, false),
    (v_uid, v_month, 'expense', '2026-08-07',    600.00, 'loan interest <30k>',       null,        true, false),
    (v_uid, v_month, 'expense', '2026-08-07',  46259.50, 'salary',                    null,        true, false),
    (v_uid, v_month, 'expense', '2026-08-15',  10152.00, 'epf',                       null,        true, false),
    (v_uid, v_month, 'expense', '2026-08-15',  30000.00, 'subcon-ksl <22/7/26>',      null,        true, false),
    (v_uid, v_month, 'expense', '2026-08-15',  20000.00, 'subcon-ehsan <22/7/26>',    null,        true, false),
    (v_uid, v_month, 'expense', '2026-08-15',  22500.00, 'subcon-ksk <31/7/26>',      null,        true, false),
    (v_uid, v_month, 'income',  '2026-08-17',  17000.00, 'ragawang',                  'Confirmed', true, false),
    (v_uid, v_month, 'expense', '2026-08-31',   2000.00, 'Hardware',                  null,        true, false),
    (v_uid, v_month, 'expense', '2026-08-31',   3000.00, 'ot',                        null,        true, false),
    (v_uid, v_month, 'expense', '2026-08-31',   5000.00, 'loan intrest <100k>',       null,        true, false),
    (v_uid, v_month, 'expense', '2026-08-31',   9150.00, 'office expenses',           null,        true, false);
end $$;
