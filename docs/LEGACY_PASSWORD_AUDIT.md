# Club One — Audit du champ legacy `staff_users.password` (2026-07-06)

> Preuve : **niveau 1** (lecture statique code) + **niveau 4** (interrogation read-only de la prod,
> `supabase_prod_ro`, `read_only=true`). **Aucune valeur de mot de passe lue ni exportée** — uniquement
> présence / comptes / chemins. Production **jamais écrite**.

## COLONNE PRÉSENTE

`public.staff_users.password` — **présente**, type `text`, **en clair** (aucun hash). Vestige du tout
premier front (pré-Supabase-Auth).

## NOMBRE DE LIGNES NON NULL

| métrique (prod) | valeur |
|---|---|
| `staff_users` total | 10 |
| `password` NON NULL | **10 / 10** |
| `password` non vide (`btrim <> ''`) | **10 / 10** |
| `auth_id` lié (GoTrue) | **10 / 10** |

→ Les 10 comptes portent un mot de passe **en clair au repos**, ET sont **déjà** tous liés à un
utilisateur GoTrue (`auth_id`). La double présence est la source du risque : le clair n'est plus utile
(l'auth passe par GoTrue) mais il reste stocké.

## CHEMINS DE CODE QUI LA LISENT ENCORE

**Aucun, à l'exécution.** Le chemin de login réel (`lib/authSession.ts` → `signInStaffUser`,
`app/page.tsx:2272` → `login()`) appelle **GoTrue** `supabase.auth.signInWithPassword({ email:
'<username>@clubone.local', password })`, puis résout le profil via `rpc('get_my_profile')`
(`staff_users WHERE auth_id = auth.uid()`). Le mot de passe saisi est vérifié par **GoTrue contre
`auth.users`**, jamais contre `staff_users.password`.

- `LoginView` (`app/page.tsx:4419`) = simple formulaire ; **plus aucune comparaison de mot de passe en
  clair côté client** (le trou historique décrit dans `AUDIT_CLUB_ONE.md:99`, ex-`page.tsx` l.916-948,
  a été supprimé lors du passage à Auth).
- Occurrences résiduelles de « password » = champ de formulaire GoTrue, script de seed, mocks de test,
  migrations/documents historiques. **Aucune requête `select … password … from staff_users`** dans
  `app/` ou `lib/`.

## RPC QUI L'UTILISENT ENCORE

**Aucune en production.** `verify_staff_login` et `set_staff_password` (définies dans
`0001_auth_hashing.sql`) **n'existent pas en prod** (`to_regprocedure` = false pour les deux) — la prod
n'a jamais appliqué 0001 littéralement. De plus, ces deux fonctions lisent `password_hash` (colonne
distincte, **absente** en prod), **pas** le `password` en clair. Aucune RPC prod ne lit le clair.

## FALLBACKS DE LOGIN ENCORE ACTIFS

**Aucun.** Un seul mécanisme d'authentification est actif : **GoTrue** (email synthétique
`<username>@clubone.local` + JWT). Pas de repli « compare le clair » côté client, pas de RPC de login
legacy exécutable. `0043_revoke_truncate_and_legacy_login.sql` révoque par ailleurs l'EXECUTE de
`verify_staff_login` là où elle existe (défense en profondeur, no-op en prod puisqu'absente).

## ACCESSIBILITÉ ACTUELLE (état prod pré-cutover)

`staff_users` : **RLS activée, AUCUNE policy** (verrouillée `service_role` seul) + **aucun grant**
`anon`/`authenticated` (cf. `backups/prod-structural-snapshot-2026-07-05.md`). → Le clair n'est
**déjà pas** lisible via l'API PostgREST (anon/authenticated). `0009` conserve ce verrouillage
(`revoke all on staff_users from anon, authenticated`).

## RISQUE APRÈS CUTOVER

**Classement : IMPORTANT (pas Bloquant).** Ce n'est **pas** un contournement d'authentification actif
(aucun chemin ne lit le clair ; la colonne n'est pas exposée à l'API). Le risque est **au repos** :

1. **Exposition at-rest** : toute personne avec accès base (clé `service_role` fuitée, backup/PITR
   exfiltré, accès dashboard Supabase) lit **10 mots de passe en clair** → **credential stuffing** si
   réutilisés ailleurs par le staff.
2. **Réintroduction** : si un futur changement re-`grant SELECT` sur `staff_users` à `authenticated`,
   ou recrée une RPC lisant le clair, le clair redevient exploitable.
3. **Conformité / hygiène** : stocker des mots de passe en clair est une non-conformité en soi.

## PLAN DE NEUTRALISATION

Stratégie : **GoTrue = seule autorité d'auth ; le clair est effacé au repos ; la colonne est retirée
après période de sécurité.** Aucune suppression sans rollback + GO explicite.

1. **Pré-requis (déjà satisfait)** : 10/10 staff ont `auth_id`. **Confirmer le login GoTrue bout-en-bout
   pour chaque rôle** avant neutralisation (cf. `docs/` GoTrue e2e — Task 8). Tant que ce n'est pas
   confirmé sur non-prod, ne pas neutraliser.
2. **Neutralisation (GO-gated, réversible)** — migration `0053_neutralize_legacy_password.sql`
   (fournie, **non exécutée**) : écrase le clair par un **sentinelle non-secret**
   (`update public.staff_users set password = 'legacy-neutralized-see-gotrue'`). La colonne est
   **conservée** (rollback-safe) ; RLS/grants inchangés (déjà verrouillés). Effet : **plus aucun secret
   en clair au repos**, login GoTrue **inchangé** (rien ne lit cette colonne).
3. **Retrait (follow-up, après soak)** — migration ultérieure `alter table staff_users drop column
   password` une fois l'auth GoTrue stable en prod (jours/semaines). Réversible via PITR.
4. **Interdits permanents** : ne jamais re-`grant SELECT staff_users` à anon/authenticated ; ne jamais
   recréer une RPC lisant le clair. (Verrouillé par revue + RLS.)

### Rollback de la neutralisation
La neutralisation **écrase une donnée** (le clair). Rollback = **PITR / backup pris avant cutover**
(contient le clair). Mais le login **ne dépend pas** de cette colonne (GoTrue) → un rollback du cutover
n'a **pas besoin** de restaurer le clair pour que l'auth fonctionne. On ne restaure le clair **jamais**
(c'était le problème). → Étape **GO-gated explicite** : n'exécuter `0053` qu'après backup vérifié + GO.

## Verdict

Le mot de passe en clair est un **vestige dormant, non exploité et non exposé à l'API**, mais un
**passif at-rest réel**. Le paquet de bascule inclut `0053_neutralize_legacy_password.sql` (GO-gated)
pour l'effacer, puis un retrait de colonne différé. **Le cutover, une fois `0053` appliquée, ne laisse
aucun mot de passe en clair au repos ni aucun mécanisme d'auth par clair.**
