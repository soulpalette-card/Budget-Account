-- ============================================================================
-- 输入第二个分包商 PRIMO EVOLUTION SDN BHD + 它的 CERT 01（含付款清单）
-- Supabase -> SQL Editor -> New query -> 粘贴 -> Run。可重复跑，不会重复插入。
-- user_id 自动取你的账号（flysky0727@gmail.com）。
-- ============================================================================

-- 1) 分包商主档
insert into public.subcons (user_id, name, entity_type, project, scopes, contract_sum, retention_pct, date_commencement, date_completion, term_of_payment, active)
select (select id from auth.users where email = 'flysky0727@gmail.com'),
       'PRIMO EVOLUTION SDN BHD', 'company', 'SETIA ALAM (BUKIT RAJA)',
       '[{"element":"BARBENDER","rate":0,"unit":""}]'::jsonb, 'Nil', 5, 'Apr 26', 'Until complete', '45 days', true
where not exists (select 1 from public.subcons where name = 'PRIMO EVOLUTION SDN BHD');

-- 2) CERT 01（本期应付 500；付款清单合计 5000）
insert into public.subcon_claims (user_id, subcon, claim_no, claim_month, gross_amount, retention_pct, cert)
select (select id from auth.users where email = 'flysky0727@gmail.com'),
       'PRIMO EVOLUTION SDN BHD', 1, 'May25', 500, 5, '{"claimPeriod":"01st-Feb-24 to 29th-Feb-24","dateCommencement":"Apr 26","dateCompletion":"Until complete","projectTitle":"SETIA ALAM (BUKIT RAJA)","subContractor":"PRIMO EVOLUTION SDN BHD","trade":"BARBENDER","contractSum":"Nil","retentionPct":5,"claimNo":1,"periodEnding":"May25","valuationDate":"June25","termOfPayment":"45 days","workdone":0,"vo":0,"advance3":0,"addAdvance":5500,"addKsk":0,"addOthers":0,"dedPrevious":5000,"dedKsk":0,"dedBackcharge":0,"paymentHeader":"DAIF SELANGOR (2024) - PEMBINAAN SEMULA BANGUNAN DAIF DI SEKOLAH KEBANGSAAN BUKIT KUDA , KLANG, SELANGOR (BBA0015)","paymentList":[{"date":"20.05.2026","cert":"ADVANCE","amount":1000,"desc":""},{"date":"25.05.2026","cert":"ADVANCE","amount":4000,"desc":""}],"preparedBy":"Fatin","verifiedBy":"Sue","checkedBy":"Chow Leong Yen","approvedBy":"Chong Sutt Tack"}'::jsonb
where not exists (
  select 1 from public.subcon_claims where subcon = 'PRIMO EVOLUTION SDN BHD' and claim_no = 1
);
