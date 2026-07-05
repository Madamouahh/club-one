-- 0043_revoke_truncate_and_legacy_login.sql — DURCISSEMENT : révoque TRUNCATE (défense en profondeur)
-- et coupe l'accès à la fonction de login legacy `verify_staff_login`.
--
-- DÉFAUT S1 (audit lancement 2026-07-05) : Supabase accorde par défaut TRUNCATE à `authenticated` sur
-- CHAQUE table publique (constat live labo : 29 tables de base). Or RLS ne borne JAMAIS TRUNCATE
-- (c'est une opération de niveau table, pas de niveau ligne) : n'importe quel rôle applicatif
-- (server, security_counter, promoter…) muni d'un JWT authenticated pourrait, via une connexion
-- SQL directe, vider n'importe quelle table métier. Portée réelle atténuée (PostgREST n'expose pas
-- TRUNCATE — non atteignable depuis l'app), mais le REVOKE est trivial, sûr, et ferme le trou en
-- profondeur pour tout accès DB direct (ex. JWT fuité utilisé hors app).
--
-- DÉFAUT D2 (même audit) : `verify_staff_login(text,text)` (login bcrypt legacy, 0001) garde son
-- GRANT EXECUTE à anon/authenticated (jamais révoqué en 0002, qui n'a fermé que la TABLE staff_users).
-- Le login réel passe désormais par Supabase Auth (lib/authSession.ts) ; plus aucun code n'appelle
-- cette fonction (grep repo : seules 0001 def + 0002 commentaire). On coupe donc l'accès RPC pour
-- éliminer une surface d'attaque dormante (elle est SECURITY DEFINER → elle bypasse le lockdown de
-- staff_users et pourrait révéler la validité d'un couple identifiant/mot de passe historique).
-- COUPLAGE : sûr uniquement AVEC le front Supabase Auth (paquet de bascule). L'ancien front prod
-- n'appelle pas non plus verify_staff_login (il lisait staff_users en clair, chemin déjà fermé par
-- 0002/0003). On ne DROP PAS la fonction (réversibilité) — on retire seulement les grants.
--
-- Additif strict et idempotent : REVOKE (no-op si déjà révoqué) + ALTER DEFAULT PRIVILEGES pour que
-- les futures tables n'héritent plus de TRUNCATE. Aucune donnée touchée. Réversible par GRANT.

begin;

-- ── S1 : révoque TRUNCATE sur toutes les relations publiques ─────────────────────────────────
-- On boucle sur les relations réelles du schéma public — tables ordinaires ('r'), tables partitionnées
-- ('p') ET vues ('v'). Sur une vue, le grant TRUNCATE est INERTE (on ne peut pas TRUNCATE une vue),
-- mais Supabase le pose quand même via pg_default_acl → on le retire aussi pour laisser un état PROPRE
-- (sinon une vue comme guest_scores garde un grant TRUNCATE fantôme que tout audit re-signalerait).
-- anon n'a de toute façon aucun grant de table, mais on révoque des deux pour être exhaustif.
do $$
declare
  v_relname text;
begin
  for v_relname in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
  loop
    execute format('revoke truncate on public.%I from authenticated', v_relname);
    execute format('revoke truncate on public.%I from anon', v_relname);
  end loop;
end $$;

-- Empêche les FUTURES tables créées par le rôle courant d'hériter du TRUNCATE par défaut.
-- (Supabase pose ce grant via pg_default_acl ; on neutralise pour les créations à venir.)
alter default privileges in schema public revoke truncate on tables from authenticated;
alter default privileges in schema public revoke truncate on tables from anon;

-- ── D2 : coupe l'accès RPC à la fonction de login legacy ─────────────────────────────────────
-- Garde d'existence : ne pas échouer si la fonction a déjà été supprimée dans un autre environnement.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'verify_staff_login'
  ) then
    revoke all on function public.verify_staff_login(text, text) from anon;
    revoke all on function public.verify_staff_login(text, text) from authenticated;
    revoke all on function public.verify_staff_login(text, text) from public;
    raise notice '0043: grants EXECUTE de verify_staff_login révoqués (anon/authenticated/public)';
  end if;
end $$;

commit;
