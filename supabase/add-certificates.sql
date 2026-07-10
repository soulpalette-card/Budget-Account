-- ============================================================================
-- 新增「进度证书 / Cert」表（给 QS 记录每个 subcon 每期 claim）
-- ----------------------------------------------------------------------------
-- Supabase → SQL Editor → New query → 粘贴 → Run。跑一次即可，可重复跑。
-- 一行 = 一个分包商(subcon)的一期 claim：第几期、几月份、本期金额、保留金%。
-- 累计、本期应付净额由程序自动算，不入库。数据全公司共享（登录用户看同一份）。
-- ============================================================================

create table if not exists public.subcon_claims (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  subcon        text not null,                       -- 分包商名称（分组依据）
  claim_no      integer not null default 1,          -- 第几期 claim
  claim_month   text,                                -- 月份，例如 "2026-07"
  gross_amount  numeric(14,2) not null default 0,    -- 本期金额（未扣保留金）
  retention_pct numeric(6,2) not null default 0,     -- 保留金百分比
  note          text,                                -- 备注
  created_at    timestamptz not null default now()
);

create index if not exists subcon_claims_subcon_idx on public.subcon_claims (subcon);

-- ===== 开启 RLS + 共享策略（登录用户共用同一份，和其它表一致）=====
alter table public.subcon_claims enable row level security;

drop policy if exists "certs_shared_select" on public.subcon_claims;
create policy "certs_shared_select" on public.subcon_claims
  for select using (auth.uid() is not null);

drop policy if exists "certs_shared_insert" on public.subcon_claims;
create policy "certs_shared_insert" on public.subcon_claims
  for insert with check (auth.uid() is not null);

drop policy if exists "certs_shared_update" on public.subcon_claims;
create policy "certs_shared_update" on public.subcon_claims
  for update using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists "certs_shared_delete" on public.subcon_claims;
create policy "certs_shared_delete" on public.subcon_claims
  for delete using (auth.uid() is not null);
