# Club One — PRÉFLIGHT HUMAIN DU JOUR J (à compléter à la main)

> À remplir **le jour du cutover**, juste avant la première écriture prod. **Toutes les cases doivent
> être vertes.** Si une seule manque → **ne rien écrire** (règle fondateur). Ce document est le
> registre signé de la porte d'entrée. Fenêtre autorisée : **mercredi 8 juillet 2026, 10:00–12:00
> Europe/Paris**.

## Identité & autorisation

- [ ] **Date & fenêtre confirmées** : ______ (attendu : 2026-07-08, 10:00–12:00 Europe/Paris) — **fenêtre OUVERTE** au moment de l'exécution : ______
- [ ] **project_ref production confirmé** : `xsotmjnaffaibgqgookt`
- [ ] **Chemin d'écriture production explicitement autorisé** : ______ (par défaut la prod est en LECTURE SEULE ; préciser QUI ouvre l'écriture et COMMENT — opérateur exécutant le runbook lui-même, ou re-pointage MCP prod-write le jour J. Sans cette autorisation explicite : aucune écriture.)

## Personnes

- [ ] **Opérateur cutover** (exécute les migrations) : ______
- [ ] **Opérateur rollback** (autorité rollback, joignable temps réel) : ______

## Code gelé

- [ ] **SHA local** (commit de gel) : ______
- [ ] **SHA distant** (après push manuel) : ______ (doit == SHA local)
- [ ] **Branche distante** : `origin/feat/club-one-launch-july-2026`
- [ ] **Aucun merge / aucune PR** effectué automatiquement.
- [ ] Guard `npm run test:migrationsregistry` = 7/7 · `npx tsc --noEmit` = 0 err au SHA gelé.

## Sauvegarde / rollback

- [ ] **Sauvegarde managée Supabase confirmée** (dashboard) : ______
- [ ] **PITR activé** ; **horodatage du dernier point restaurable noté** : ______ (cible rollback)
- [ ] **Snapshot structurel** régénéré : `backups/prod-structural-snapshot-<date>.md` : ______
- [ ] Runbook rollback relu (`docs/PRODUCTION_ROLLBACK_RUNBOOK.md`).

## État opérationnel prod

- [ ] **Write freeze confirmé** (ancien front en maintenance / aucun staff en écriture) : ______
- [ ] **Tables opérationnelles clôturées / propres** : `select count(*) from public.club_tables where status<>'free' or coalesce(client,'')<>'' or coalesce(expenses,'[]'::jsonb)<>'[]'::jsonb;` → **0**.
  - Note : au 2026-07-06, **VIP1/VIP2/VIP3** étaient non-libres (STALE, ~4 j, event_date NULL). Les nettoyer via `supabase/manual_actions/cleanup_stale_vip_tables.sql` (après confirmation fondateur) → attendre **0**.
- [ ] **Aucune soirée active / aucune réservation critique en cours** : ______

## Bootstrap (précondition dure de 0009)

- [ ] **Événement de bootstrap prêt** : la prod a actuellement **0 event**. Le fondateur fournit :
  - Nom de la soirée : ______
  - Date (YYYY-MM-DD) : ______
  - Heure de début : ______  · Heure de fin (indicative) : ______
  - Espace / venue (`venue_id` existant) : ______
  - Statut initial (`draft` / `published`) : ______
  - Responsable(s) : ______
- [ ] Événement créé en prod (via `supabase/manual_actions/bootstrap_launch_event_TEMPLATE.sql`), `id` noté : ______
- [ ] 10 `staff_users` liés Auth (`auth_id`) — vérifié (attendu 10/10).

## GO d'exécution

- [ ] **Toutes** les cases ci-dessus vertes. Sinon **NO-GO**, ne rien écrire.
- [ ] Le fondateur redonne le **GO CUTOVER PRODUCTION** dans la fenêtre ouverte.
- [ ] On déroule `docs/PRODUCTION_CUTOVER_RUNBOOK.md` porte par porte, en vérifiant chaque résultat
      (0008 APPLIED · BOOTSTRAP COMPLETED · 0009 PRECONDITIONS PASSED · ANON=0 · 0052 VENUE · 0053 ANON
      REVOCATION · FINAL MIGRATION COUNT). Arrêt immédiat + rollback sur tout critère d'arrêt.
