-- neutralize_legacy_password.sql — ACTION MANUELLE CONTRÔLÉE (mode B, GO fondateur).
--
-- ⚠️ CE FICHIER N'EST PAS UNE MIGRATION. Il vit hors de supabase/migrations/ : aucun `migrate up`,
-- aucun `supabase db push`, aucun runner CI ne l'exécute. Il ne part QUE lancé à la main, sous GO
-- fondateur explicite, ET avec la phrase d'autorisation EXACTE ci-dessous. Double garde :
--   (1) phrase d'autorisation de session ; (2) préflight bloquant (tous les staff ont un auth_id).
--
-- Objet : efface le mot de passe legacy en clair (staff_users.password → sentinelle non-secret).
-- La colonne est CONSERVÉE (retrait différé). cf. docs/LEGACY_PASSWORD_AUDIT.md.
-- Aucune valeur de mot de passe n'est lue, affichée, hashée ni exportée.
--
-- USAGE :
--   set clubone.cutover_authorization = 'NEUTRALIZE LEGACY PASSWORD - FOUNDER APPROVED';
--   \i supabase/manual_actions/neutralize_legacy_password.sql

begin;

do $$
declare
  v_auth text;
  v_missing_auth int;
  v_col int;
begin
  -- (1) Phrase d'autorisation EXACTE (sinon refus — protège d'un lancement accidentel par un runner).
  v_auth := current_setting('clubone.cutover_authorization', true);
  if v_auth is distinct from 'NEUTRALIZE LEGACY PASSWORD - FOUNDER APPROVED' then
    raise exception 'REFUS action manuelle GO-gated : définir d''abord `set clubone.cutover_authorization = ''NEUTRALIZE LEGACY PASSWORD - FOUNDER APPROVED'';` (phrase exacte, sous GO fondateur).';
  end if;

  -- Colonne déjà absente ? (retrait déjà fait) → rien à faire.
  select count(*) into v_col from information_schema.columns
   where table_schema='public' and table_name='staff_users' and column_name='password';
  if v_col = 0 then
    raise notice 'Colonne password déjà absente — aucune action.';
    return;
  end if;

  -- (2) Préflight bloquant : aucun staff sans auth_id (login GoTrue garanti avant d'effacer le legacy).
  select count(*) into v_missing_auth from public.staff_users where auth_id is null;
  if v_missing_auth > 0 then
    raise exception 'REFUS : % staff sans auth_id — migration GoTrue incomplète, neutralisation refusée.', v_missing_auth;
  end if;

  update public.staff_users
     set password = 'legacy-neutralized-see-gotrue'
   where password is distinct from 'legacy-neutralized-see-gotrue';

  raise notice 'Mot de passe legacy neutralisé (sentinelle non-secret ; colonne conservée). Action manuelle contrôlée exécutée.';
end;
$$;

commit;
