-- 0042_enable_realtime_publication.sql — ACTIVE LA PUBLICATION REALTIME DES 4 TABLES LIVE.
--
-- DÉFAUT R1 (audit lancement 2026-07-05) : le front s'abonne à `postgres_changes` sur quatre tables
-- (app/page.tsx:1538-1552 — club_tables, entry_logs, promoter_contacts, promoter_guest_entries) MAIS
-- AUCUNE migration n'a jamais ajouté ces tables à la publication `supabase_realtime`. Constat live :
-- `SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime'` = 0 (labo ET, par
-- absence de toute migration ALTER PUBLICATION, prod). Conséquence : les abonnements ne reçoivent
-- JAMAIS d'événement → deux postes staff (deux téléphones sur le plancher) ne se synchronisent pas ;
-- une table servie sur le poste A n'apparaît sur le poste B qu'après un rechargement manuel. Le badge
-- « Live » du front est allumé inconditionnellement (setIsOnline(true)) → il ment.
--
-- CORRECTIF : ajouter EXACTEMENT les 4 tables auxquelles le front s'abonne à la publication Realtime.
-- La RLS déjà en place (0009 cutover + suivantes) reste l'autorité : Supabase Realtime applique la RLS
-- du rôle abonné aux événements `postgres_changes` → un promoteur ne reçoit que les changements des
-- lignes qu'il peut voir, la direction tout. Aucune donnée n'est exposée au-delà de ce que la RLS
-- autorise déjà en lecture. On N'ajoute PAS de table PII au-delà de ces 4 (pas de guests/staff_*).
--
-- Additif strict et idempotent : DO block qui n'ajoute une table que si elle n'est pas déjà publiée
-- (réexécutable sans erreur « relation is already member of publication »). Aucune table/colonne/
-- policy/donnée touchée. Réversible : `ALTER PUBLICATION supabase_realtime DROP TABLE <t>`.
--
-- NB : cette migration est indépendante du cutover RLS (0009) — elle est sûre sur n'importe quelle
-- base où les 4 tables existent (elles existent depuis le socle). Elle rejoint le paquet de bascule
-- prod par son numéro (≥ 0042) mais ne dépend pas de l'ordre d'application des autres migrations.

begin;

do $$
declare
  v_table text;
  v_targets text[] := array[
    'club_tables',
    'entry_logs',
    'promoter_contacts',
    'promoter_guest_entries'
  ];
begin
  -- La publication supabase_realtime est créée par Supabase à l'initialisation du projet. Garde
  -- fail-safe : si elle n'existe pas (base non-Supabase), on ne fait rien plutôt que d'échouer.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice '0042: publication supabase_realtime absente — aucune action (base non-Supabase ?)';
    return;
  end if;

  foreach v_table in array v_targets loop
    -- N'ajoute que si la table existe ET n'est pas déjà membre (idempotence).
    if exists (
      select 1 from pg_tables where schemaname = 'public' and tablename = v_table
    ) and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
      raise notice '0042: % ajoutée à supabase_realtime', v_table;
    end if;
  end loop;
end $$;

commit;
