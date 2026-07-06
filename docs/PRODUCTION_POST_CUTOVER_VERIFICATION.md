# Club One — Vérification POST-CUTOVER production (PHASE C)

> À exécuter juste après la bascule, avant de rouvrir aux utilisateurs. **Un seul item rouge → décision
> rollback** (`PRODUCTION_ROLLBACK_RUNBOOK.md`). Les tests d'écriture se font avec des données de test
> identifiables, hors soirée.

## Contrat automatique
- [ ] `supabase/verification/cutover_contract_harness.sql` → **`CONTRACT HARNESS OK`** (structure, RLS,
      grants, Realtime 4 tables, anon zéro grant, RPC legacy révoquées, venue exposé).
- [ ] Empreinte de schéma finale == empreinte cible (`PRODUCTION_CUTOVER_PACKAGE.md` §5) : 42 tables,
      47 fonctions, 129 policies, 6 md5 identiques.

## Login des 7 rôles (GoTrue réel)
> 6 rôles distincts en base (admin, manager, promoter, server, security, security_counter) ; le « 7ᵉ »
> = 2ᵉ promoteur/serveur pour l'isolation. Se connecter réellement avec chaque compte prod.
- [ ] **admin** : login OK, voit tout (18 tables, QR, stats, clôture).
- [ ] **manager** : login OK, accès complet.
- [ ] **promoter** : login OK, **ne voit que ses tables/contacts/invitations** ; QR/Sécurité/Flux/Stats refusés.
- [ ] **server** : login OK, voit tables non attribuées + les siennes ; pas d'attribution/QR/gestion.
- [ ] **security** : login OK, onglet Sécurité via snapshot ; **aucun accès direct** `club_tables` ; QR OK.
- [ ] **security_counter** : login OK, Flux (compteur + QR) ; aucune modif résa/dépense.
- [ ] 2ᵉ promoteur : ne voit **rien** du 1ᵉʳ (isolation).

## Parcours métier (données de test)
- [ ] **Réservation/table** : admin/manager crée/modifie une table → OK ; promoteur sur table d'autrui → refusé.
- [ ] **Dépense** : `add_expense_v3` par promoteur sur SA table → OK ; sur table étrangère → refusé ; 2 dépenses successives → aucune perte.
- [ ] **QR** : `create_promoter_invitation_v2` génère un token côté serveur ; check-in par security → validé ; rejeu → « déjà utilisé » ; server → refusé.
- [ ] **Flux** : `add_entry_log_v2` par security_counter → OK ; par promoteur → refusé.

## Realtime (2 postes)
- [ ] `scripts/realtime-e2e.mjs` (ou 2 téléphones réels) : modif autorisée reçue par le rôle autorisé ;
      **non reçue** par un rôle non autorisé (pas de fuite) ; reconnexion après refresh OK.

## Cycle d'événement
- [ ] `get_active_event_context` renvoie l'événement bootstrappé + venue.
- [ ] (Répétition de clôture/activation à réserver à un test contrôlé, PAS sur la vraie soirée à venir.)

## Sécurité résiduelle
- [ ] `0053` appliquée : anon = 0 grant de table ; site public (get_invite/public_events) fonctionne encore.
- [ ] **Action manuelle** `neutralize_legacy_password` exécutée (PHASE C-bis, après login GoTrue prouvé + backup) : `select count(*) from staff_users where password is not null and password <> 'legacy-neutralized-see-gotrue';` → **0** (aucun clair). N'affiche aucune valeur.

## Surveillance & front mobile
- [ ] Aucune erreur en console navigateur ni dans les logs Supabase (`get_logs`) pendant 15 min.
- [ ] **Validation front mobile** (viewport, hit-targets, badge « Live » réellement live) sur un vrai téléphone.
- [ ] Surveillance des erreurs applicatives maintenue 24–48 h post-cutover.

## Déclaration
- [ ] **Toutes** les cases vertes → cutover **réussi**, réouverture autorisée par le décideur.
- [ ] Sinon → `PRODUCTION_ROLLBACK_RUNBOOK.md`.
