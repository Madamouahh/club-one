-- 0066_staff_performance.sql — Module RH / PERFORMANCE (B7) : agrégation HONNÊTE, aucun score inventé.
--
-- Ce module NE fabrique aucune donnée : il n'est qu'une VUE d'agrégation en LECTURE SEULE au-dessus des
-- faits réels de staff_shifts (migration 0011) — shifts planifiés / confirmés, présences confirmées,
-- retards, absences. Il n'existe AUCUN « score de performance » arbitraire : uniquement des comptages de
-- faits (statuts réellement saisis par la direction lors du pointage) et un taux de présence dérivé
-- honnêtement (présents / décisions de présence réellement enregistrées ; null tant qu'aucune n'existe).
--
-- Rien n'est produit tant que la direction n'a pas saisi de shifts : base vide → vue vide (état honnête).
-- Les heures/coût staff restent hors périmètre ici (déjà produits, sans divergence, par lib/rhPlanning +
-- lib/rhRollup côté client) : cette vue se cantonne aux FAITS D'ASSIDUITÉ (comptages + taux de présence).
--
-- Sécurité (direction seule) — DÉFENSE EN PROFONDEUR, trois barrières indépendantes :
--   1. security_invoker = true : la vue s'exécute avec les droits de l'appelant, donc la RLS 0011 de
--      staff_members / staff_shifts s'applique réellement (aucune élévation de privilège, pas de vue
--      « SECURITY DEFINER » masquant la RLS) ;
--   2. garde explicite `current_staff_role() in ('admin','manager')` : un salarié obtient un résultat
--      VIDE (jamais l'assiduité de ses collègues) ; current_staff_role() est SECURITY DEFINER, non
--      falsifiable par le client ;
--   3. anon = zéro grant (invariant 0009/0053) : la vue n'est jamais lisible sans session authentifiée.
-- Une vue suffit ici (agrégation en lecture seule, RLS-scopée par 1+2) : aucun RPC SECURITY DEFINER requis.

begin;

-- ============================================================
-- VUE staff_performance_v1 — un enregistrement par salarié, agrégé sur TOUS ses shifts réels.
-- security_invoker = true → la RLS 0011 des tables sous-jacentes s'applique à l'appelant.
-- ============================================================
drop view if exists public.staff_performance_v1;

create view public.staff_performance_v1
  with (security_invoker = true)
as
select
  m.id                                    as staff_member_id,
  m.username                              as username,
  m.full_name                             as full_name,
  m.poste                                 as poste,
  m.actif                                 as actif,
  -- Comptages de FAITS (statuts réellement saisis). LEFT JOIN → un salarié sans shift = zéros honnêtes.
  count(s.id)                                                                          as shifts_total,
  -- Planifiés : engagement au planning (non annulé, non « absent »). Miroir de PLANNED_STATUSES (rhPlanning).
  count(s.id) filter (where s.status in ('planifie','confirme','present','retard'))    as shifts_planned,
  -- Confirmés : le salarié a confirmé sa venue (confirmé, puis éventuellement présent / en retard).
  count(s.id) filter (where s.status in ('confirme','present','retard'))               as shifts_confirmed,
  -- Présents : la personne était là (présent OU en retard). Miroir de PRESENT_STATUSES (rhPlanning).
  count(s.id) filter (where s.status in ('present','retard'))                          as shifts_present,
  count(s.id) filter (where s.status = 'retard')                                       as shifts_late,
  count(s.id) filter (where s.status = 'absent')                                       as shifts_absent,
  count(s.id) filter (where s.status = 'annule')                                       as shifts_cancelled,
  -- Décisions de présence RÉELLEMENT enregistrées (présent / retard / absent) = dénominateur du taux.
  count(s.id) filter (where s.status in ('present','retard','absent'))                 as attendance_recorded,
  -- Taux de présence = présents / décisions enregistrées. NULL tant qu'aucune décision n'existe :
  -- on n'invente pas 0 %/100 % pour un salarié dont l'assiduité n'a jamais été pointée.
  case
    when count(s.id) filter (where s.status in ('present','retard','absent')) = 0 then null
    else round(
      count(s.id) filter (where s.status in ('present','retard'))::numeric
        / count(s.id) filter (where s.status in ('present','retard','absent')),
      4)
  end                                                                                  as presence_rate,
  max(s.exploitation_date)                                                             as last_shift_date
from public.staff_members m
left join public.staff_shifts s on s.staff_member_id = m.id
-- Garde direction (barrière 2) : indépendante de la ligne, évaluée une fois → salarié = résultat vide.
where public.current_staff_role() in ('admin','manager')
group by m.id, m.username, m.full_name, m.poste, m.actif;

comment on view public.staff_performance_v1 is
  'B7 — Assiduité du personnel : agrégation LECTURE SEULE des faits réels de staff_shifts (0011). '
  'Aucun score inventé : comptages par statut + taux de présence honnête (null si non pointé). '
  'security_invoker + garde direction + anon zéro grant.';

-- Grants : direction via authenticated (RLS + garde direction font le reste) ; anon = zéro grant.
grant select on public.staff_performance_v1 to authenticated;
revoke all on public.staff_performance_v1 from anon;

commit;
