-- 0053_revoke_anon_all_tables.sql — RÉTABLIT « anon = ZÉRO grant de table » sur TOUT le schéma public.
-- (Renuméroté 0054 → 0053 au paquet de bascule : la neutralisation du mot de passe legacy est sortie
--  de la chaîne de migration vers supabase/manual_actions/neutralize_legacy_password.sql — action
--  manuelle GO-gated, mode B ; cf. docs/FINAL_MIGRATION_ORDER.md.)
--
-- CONSTAT (harness de contrat post-cutover, 2026-07-06, prouvé live sur le clone) : `0009` exécute
-- `revoke all on all tables in schema public from anon`, MAIS les tables des verticaux créées APRÈS
-- `0009` (surtout les modules neufs 0046-0051 : equipment, maintenance_interventions, stock_items,
-- stock_movements, suppliers, purchase_orders, purchase_order_lines, commercial_leads,
-- commercial_quotes, marketing_campaigns, budget_forecasts) récupèrent des grants `anon`
-- (SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER) via les DEFAULT PRIVILEGES par défaut de Supabase.
--
-- IMPACT RÉEL : **pas de fuite** — ces tables ont toutes la RLS activée et AUCUNE policy `anon`
-- (anon lit 0 ligne, écrit = violation RLS). MAIS l'invariant de défense en profondeur de `0009`
-- (« anon n'a AUCUN grant de table ») ne tient plus globalement → brèche latente (si une policy anon
-- était ajoutée par erreur un jour, le grant serait déjà là). anon n'accède JAMAIS à une table en
-- direct dans le produit (il n'utilise que des RPC SECURITY DEFINER : get_invite, public_events,
-- create_table_reservation_request anon). Retirer tous ses grants de table est donc SÛR.
--
-- CORRECTIF : re-révoquer TOUT grant de table `anon` + neutraliser les DEFAULT PRIVILEGES pour que
-- les futures tables ne re-grantent plus `anon`. Additif/idempotent (REVOKE = no-op si déjà retiré),
-- aucune donnée touchée, réversible. À placer en FIN de chaîne de cutover (après tous les verticaux).

begin;

-- 1) Retire tout privilège de table/vue anon existant sur public (RLS reste l'autorité).
revoke all on all tables in schema public from anon;

-- 2) Empêche les futures tables de re-granter anon (défaut Supabase). Best-effort par rôle créateur.
do $$
declare r text;
begin
  foreach r in array array['postgres','supabase_admin','authenticator'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      begin
        execute format('alter default privileges for role %I in schema public revoke all on tables from anon', r);
      exception when others then
        raise notice '0054: default privileges pour % non modifiables (%), ignoré', r, sqlerrm;
      end;
    end if;
  end loop;
  -- Défaut du rôle courant (celui qui exécute la migration), au cas où distinct des ci-dessus.
  begin
    alter default privileges in schema public revoke all on tables from anon;
  exception when others then
    raise notice '0054: default privileges (rôle courant) non modifiables (%), ignoré', sqlerrm;
  end;
end;
$$;

commit;
