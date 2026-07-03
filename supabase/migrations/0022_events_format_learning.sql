-- 0022_events_format_learning.sql — Étiquette de programmation « format » sur les événements.
-- ADDITIF STRICT au-dessus de 0004 (events). N'ajoute qu'UNE colonne NULLABLE : aucune ligne
-- existante n'est modifiée, aucune contrainte existante touchée, AUCUN seed (la base ship VIDE —
-- l'étiquette est renseignée par le fondateur, jamais inventée par le code).
--
-- Contexte : la « boucle d'apprentissage » CRM (spec MODULE_CRM_CLIENTS_VIP §148-156) croise le Z de
-- caisse (CA réel) et les visites clients pour comparer les soirées ENTRE ELLES. La règle de la spec
-- est explicite : « Ajouter `format` à `events` (genre/DJ/thème/prix d'entrée) — sans étiquette, pas
-- d'apprentissage. » Tant que la soirée n'est pas étiquetée, le rollup mensuel la range dans un seau
-- « non étiqueté » et le signale (lib/crmLearning · FORMAT_UNLABELED) : on ne fabrique aucun insight.
--
-- Ce que la colonne dit (et ne dit pas) :
--   · format : libellé libre de PROGRAMMATION (ex. 'techno', 'hip-hop', 'guest DJ', 'gratuit avant 1h').
--              NULL = soirée non étiquetée (état honnête par défaut). Ce n'est PAS une donnée client,
--              PAS une donnée de paie : c'est une métadonnée de programmation, portée par la même
--              policy events_write que le reste de la ligne événement (0004).
--
-- Sécurité / RLS : la colonne hérite de la RLS existante de `events` (0004) — lecture pour tout staff
--   authentifié (events_read), écriture pour admin/manager/promoter (events_write). Aucune policy
--   nouvelle n'est requise. NB de gouvernance (hors périmètre de cette migration, à trancher plus
--   tard) : si le fondateur veut réserver l'étiquetage de programmation à la direction seule, cela
--   relèvera d'un durcissement colonne-level de `events` (même schéma que 0021 sur staff_members),
--   PAS d'un ajout de colonne. Ici on ne fait qu'ouvrir la structure, sans élargir aucun accès.

begin;

alter table public.events add column if not exists format text;

comment on column public.events.format is
  'Étiquette de programmation (genre/DJ/thème/prix) pour la boucle d''apprentissage CRM. '
  'NULL = non étiquetée. Renseignée par la direction, jamais inventée.';

commit;
