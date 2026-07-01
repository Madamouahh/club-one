# 20 — Securite Supabase

- Ne jamais afficher, committer ou faire circuler une cle `service_role`, `sb_secret`, un mot de passe, ou le contenu de `scripts/staff-passwords.local.json`.
- Ne jamais utiliser `service_role` cote client. Le front n'utilise que la cle anon + Supabase Auth (JWT).
- Ne jamais faire confiance au role, au username ou a l'`event_id` envoye par le client : toute regle metier sensible est verifiee cote SQL (`current_staff_role()`, policies RLS, RPC `SECURITY DEFINER`).
- Toute fonction `SECURITY DEFINER` doit fixer `search_path` explicitement (`set search_path = public`) et restreindre ses `GRANT EXECUTE` au strict necessaire (jamais `PUBLIC`).
- Ne jamais desactiver RLS pour contourner un probleme ; corriger la policy ou la fonction plutot que d'ouvrir un acces.
- Ne jamais lancer `supabase db push`, `supabase migration up`, ou `supabase link` sans GO explicite — et jamais sur la base operationnelle en tant qu'environnement de test.
- Separation stricte production / non-production : toute migration reelle (`0008`, `0009`, ou future) se teste d'abord sur un projet Supabase non-production isole, avec ses propres variables Preview, avant toute application sur la base operationnelle.
- Une migration de cutover RLS doit toujours passer par : preflight en lecture seule → execution transactionnelle avec gardes explicites (`raise exception` sur precondition manquante) → postflight en lecture seule.
- Les restrictions cote UI (masquer un bouton, un onglet) ne constituent jamais une securite : la regle doit exister cote RLS/RPC.
