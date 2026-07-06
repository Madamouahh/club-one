# Actions manuelles contrôlées (HORS chemin de migration automatique)

> Ce dossier n'est **PAS** `supabase/migrations/`. Aucun outil standard (`supabase db push`,
> `supabase migration up`, un runner CI de migrations) ne l'exécute : ces scripts se lancent
> **uniquement à la main**, sous **GO fondateur explicite**, avec une **phrase d'autorisation exacte**.

## Pourquoi

Certaines opérations **modifient des données** de production et sont irréversibles sans PITR. Elles ne
doivent JAMAIS partir par un simple `migrate up`. On les sort donc de la chaîne numérotée
`0008…` (que le re-rehearsal et le cutover rejouent intégralement et automatiquement) et on les place
ici, derrière une double garde : **préflight bloquant** + **phrase d'autorisation**.

## Inventaire

| Fichier | Objet | Mode | Garde |
|---|---|---|---|
| `neutralize_legacy_password.sql` | Efface le mot de passe legacy en clair (`staff_users.password` → sentinelle) | **B — post-cutover, GO fondateur** | phrase exacte + préflight `auth_id` |

## Procédure (neutralize_legacy_password)

1. **Préconditions humaines** (cf. `docs/LEGACY_PASSWORD_AUDIT.md` + `docs/PRODUCTION_POST_CUTOVER_VERIFICATION.md`) :
   - Login **GoTrue prouvé bout-en-bout** pour tous les rôles (scripts/gotrue-e2e.mjs vert en non-prod ;
     smoke humain des 6 rôles en prod post-cutover).
   - **Backup/PITR vérifié** (le clair effacé n'est récupérable que par PITR).
2. Dans une session SQL **manuelle** (éditeur Supabase / psql), définir la phrase d'autorisation
   **exacte** puis lancer le script :
   ```sql
   set clubone.cutover_authorization = 'NEUTRALIZE LEGACY PASSWORD - FOUNDER APPROVED';
   \i supabase/manual_actions/neutralize_legacy_password.sql   -- ou coller son contenu
   ```
   Sans la phrase exacte, le script **refuse de s'exécuter** (raise exception). Le préflight refuse
   aussi si un staff n'a pas d'`auth_id`.
3. Vérifier ensuite : `select count(*) from staff_users where password is not null and password <> 'legacy-neutralized-see-gotrue';` → **0**.

## Interdits

- Ne JAMAIS déplacer ces fichiers dans `supabase/migrations/`.
- Ne JAMAIS afficher, exporter, hasher dans un rapport, ni copier une valeur de mot de passe.
- Retrait de la colonne `password` = migration ultérieure séparée, après période de sécurité.
