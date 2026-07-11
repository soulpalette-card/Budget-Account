-- ============================================================================
-- 新增「分包商主档 / Subcon」表（出证书前先建好每个 subcon 的基本资料）
-- ----------------------------------------------------------------------------
-- Supabase → SQL Editor → New query → 粘贴 → Run。跑一次即可，可重复跑。
-- 一行 = 一个分包商(subcon)。存：名字、公司/个人、注册号或身份证/护照、联系人、
-- 电话、email、地址、项目、负责工种+价位(scopes jsonb)、合同额、保留金%、
-- 开工/完工日、付款期、银行户口、Ref、状态(在用/停用)、备注。
-- 出证书时从这里带出资料，只补当期金额。数据全公司共享（登录用户看同一份）。
-- ============================================================================

create table if not exists public.subcons (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  name              text not null,                    -- 分包商名字（公司/个人，也是分组依据）
  entity_type       text not null default 'individual', -- 'company'=公司 / 'individual'=个人
  id_no             text,                             -- 公司注册号(SSM) 或 身份证/护照号
  contact_person    text,                             -- 联系人（公司时用）
  phone             text,                             -- 电话
  email             text,                             -- 邮箱
  address           text,                             -- 地址
  project           text,                             -- 项目名，例如 SEPUTEH
  scopes            jsonb,                            -- 负责工种+价位：[{element,rate,unit}]
  contract_sum      text,                             -- 合同额（可填 Nil，所以用文字）
  retention_pct     numeric(6,2) not null default 0,  -- 保留金百分比（证书默认值）
  date_commencement text,                             -- 开工日
  date_completion   text,                             -- 完工日（可写 Until complete）
  term_of_payment   text,                             -- 付款期，例如 45 days
  bank_name         text,                             -- 银行名字
  bank_account_no   text,                             -- 银行户口号
  bank_account_name text,                             -- 户口名字（收款人，常和本人名不同）
  ref_la            text,                             -- Ref of LA（证书栏位）
  subcon_ref        text,                             -- Sub-Contractor Ref（证书栏位）
  note              text,                             -- 备注
  active            boolean not null default true,    -- 状态：true=在用 / false=停用
  created_at        timestamptz not null default now()
);

create index if not exists subcons_name_idx on public.subcons (name);

-- ===== 开启 RLS + 共享策略（登录用户共用同一份，和其它表一致）=====
alter table public.subcons enable row level security;

drop policy if exists "subcons_shared_select" on public.subcons;
create policy "subcons_shared_select" on public.subcons
  for select using (auth.uid() is not null);

drop policy if exists "subcons_shared_insert" on public.subcons;
create policy "subcons_shared_insert" on public.subcons
  for insert with check (auth.uid() is not null);

drop policy if exists "subcons_shared_update" on public.subcons;
create policy "subcons_shared_update" on public.subcons
  for update using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "subcons_shared_delete" on public.subcons;
create policy "subcons_shared_delete" on public.subcons
  for delete using (auth.uid() is not null);
