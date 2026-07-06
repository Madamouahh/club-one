-- ============================================================================
-- Club One — Rehearsal role/RLS matrix (CLONE ONLY, run AFTER 0008..0051)
--
-- Method: jwt-claims impersonation. Each block sets role=authenticated and a
-- real `sub` claim = a seeded staff auth_id, so auth.uid()/current_staff_role()
-- resolve and REAL RLS policies are enforced (genuine level-4/5 evidence, not UI).
--
-- Fixed auth_ids: admin=..01 manager=..02 promoter1=..03 promoter2=..04
--                 jeremy(server)=..05 server2=..06 security=..07 counter=..08
--
-- Expected visibility per role (post 0044/0045):
--   club_tables:  admin/manager=18 · promoter1=1(T03) · promoter2=0 · jeremy=15 · security=0 · counter=0
--   pge:          admin/manager=3  · promoter1=2 · promoter2=1 · others=0
--   contacts:     admin/manager=2  · promoter1=1 · promoter2=1 · others=0
--   entry_logs:   admin/manager/counter=3 · others=0
--   events:       all staff=2
--   sec_snapshot: admin/manager/security=18 · counter=0
-- ============================================================================

-- Per-role visibility counts (run each block as its own statement/txn):

-- admin
set local role authenticated; set local request.jwt.claims='{"sub":"00000000-0000-0000-0000-000000000001"}';
select 'admin' who,(select count(*) from public.club_tables) ct,(select count(*) from public.promoter_guest_entries) pge,(select count(*) from public.promoter_contacts) pc,(select count(*) from public.entry_logs) el,(select count(*) from public.events) ev,(select count(*) from public.get_security_table_snapshot()) snap;
reset role;
