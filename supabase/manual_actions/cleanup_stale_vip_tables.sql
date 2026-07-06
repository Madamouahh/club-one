-- cleanup_stale_vip_tables.sql — ACTION MANUELLE CONTRÔLÉE (prod, jour J, opérateur).
--
-- ⚠️ NON EXÉCUTÉ PAR CLAUDE. Réinitialise VIP1/VIP2/VIP3 (état résiduel 'arrived', groupées,
-- event_date NULL, dernière modif 2026-07-02 14:29:13, ~4 j sans activité — classées STALE) à l'état
-- 'free'/propre requis avant bootstrap. À N'EXÉCUTER QU'APRÈS confirmation FONDATEUR que ces 3 tables
-- ne correspondent à AUCUNE soirée live (données legacy/stale, pas d'activité en cours).
--
-- Transactionnel : par défaut ROLLBACK (sûr). L'opérateur vérifie l'aperçu, puis remplace `rollback;`
-- par `commit;` SEULEMENT s'il confirme visuellement les 3 lignes attendues. Aucune PII affichée.

begin;

-- Aperçu AVANT (ids/statuts/dates uniquement, pas de client/téléphone/PII)
select id, status, nullif(btrim(event_date),'') as event_date, updated_at
  from public.club_tables where id in ('VIP1','VIP2','VIP3') order by id;

-- Garde : refuse si l'une des 3 a été modifiée RÉCEMMENT (< 12 h) → signe d'activité live.
do $$
begin
  if exists (select 1 from public.club_tables where id in ('VIP1','VIP2','VIP3') and updated_at > now() - interval '12 hours') then
    raise exception 'REFUS : une table VIP a été modifiée < 12 h — activité potentiellement live, confirmer avant nettoyage.';
  end if;
end $$;

update public.club_tables set
  status='free', client='', phone='', people='', notes='', booker='', assigned_to='',
  linked_group_id='', linked_tables=array[]::text[], expenses='[]'::jsonb, event_date='', updated_at=now()
where id in ('VIP1','VIP2','VIP3');

-- Vérif APRÈS : 3 lignes remises à 'free'
select count(*) as reset_free
  from public.club_tables
 where id in ('VIP1','VIP2','VIP3') and status='free'
   and coalesce(client,'')='' and coalesce(expenses,'[]'::jsonb)='[]'::jsonb;
-- Attendu : 3.

-- Sécurité par défaut. Remplacer par `commit;` sous contrôle opérateur + GO fondateur.
rollback;
