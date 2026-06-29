# Audit Club One actuel - branche `security/phase0b`

Date : 2026-06-29  
Depot audite : `C:\Users\maxou\club-one`  
Branche auditee : `security/phase0b`  
Remote : `https://github.com/Madamouahh/club-one.git`  
Statut : audit seulement. Aucun reset, restore, merge, push, migration Supabase, ni modification du code metier.

## 0. Pre-vol confirme

Commandes demandees executees avant modification :

- `pwd` : `C:\Users\maxou\club-one`
- `git rev-parse --show-toplevel` : `C:/Users/maxou/club-one`
- `git remote -v` : `origin https://github.com/Madamouahh/club-one.git`
- `git branch --show-current` : `security/phase0b`
- `git status` : une seule modification locale, `package-lock.json`
- `git log --oneline -15` : HEAD = `fbd3789 docs: rapport de passation de la nuit (transmission)`
- `git log --oneline origin/main..HEAD` : 6 commits sur la branche
- `git diff -- package-lock.json` : suppression de champs `libc` dans des paquets optionnels natifs

Commits de la branche au-dessus de `origin/main` :

- `fbd3789` : ajoute `TRANSMISSION_NUIT.md`
- `1c541ca` : ajoute modele Lieux/Evenements, RPC publique `public_events`, migration depense atomique, plan comms IA
- `1595baa` : corrige l'icone PWA 512 (`icon-512.png`)
- `f280d3f` : durcit Phase 0b, corrige chargement donnees apres auth et closure realtime
- `cbcb8d7` : Supabase Auth + RLS sur toutes les tables operationnelles
- `4741185` : retrait mots de passe en dur + premiers runbooks/migrations securite

Documents existants trouves et lus :

- `AUDIT_CLUB_ONE.md`
- `SECURITY_LOT0.md`
- `SECURITY_PHASE0B.md`
- `EVENTS_ET_BOUCLE.md`
- `COMMS_IA_PLAN.md`
- `TRANSMISSION_NUIT.md`
- `README.md`
- `AGENTS.md`
- `CLAUDE.md`

Note Ruflo : `AGENTS.md` demande d'utiliser ToolSearch pour Ruflo sur les taches complexes. Recherche effectuee, aucun outil Ruflo MCP expose dans cette session.

## 1. Verifications locales

### Build

Commande : `npm run build`

Resultat : echec.

Le build compile correctement puis echoue au prerendu de `/` :

- compilation Next OK
- TypeScript interne au build OK
- erreur : `supabaseUrl is required`
- cause immediate : `createClient(supabaseUrl, supabaseAnonKey)` est execute avec `NEXT_PUBLIC_SUPABASE_URL` vide dans `app/page.tsx` et `app/invite/[token]/page.tsx`

Autre avertissement build : Next/Turbopack detecte plusieurs lockfiles et choisit `C:\Users\maxou\package-lock.json` comme racine de workspace, avec `C:\Users\maxou\club-one\package-lock.json` comme lockfile additionnel. `next.config.ts` ne definit pas `turbopack.root`.

### Typecheck

Commande : `npx tsc --noEmit`

Resultat : OK, aucune erreur TypeScript.

### Lint

Commande : `npm run lint`

Resultat : echec.

Erreurs bloquantes :

- `app/page.tsx:1414` : `react-hooks/set-state-in-effect`, `setForm(table)` appele directement dans un effet.
- `app/page.tsx:2427` : `react-hooks/purity`, `Math.random()` appele pendant le render via `useMemo`.

Avertissements :

- fonctions non utilisees : `todayInputValue`, `tableTotalForDate`, `totalRevenueForDate`, `spendGroupCountForDate`, `groupLabel`, `groupBadge`, `canEditTable`, `AgendaView`
- dependance inutile `activeEventDate` dans un `useMemo`

## 2. Etat reel termine

- Les anciens mots de passe en dur ne sont plus presents dans `app/page.tsx`.
- Le login applicatif utilise Supabase Auth (`signInWithPassword`) avec email synthetique `<username>@clubone.local`.
- Le profil staff passe par RPC `get_my_profile`, pas par lecture directe de `staff_users`.
- La page publique `/invite/[token]` passe par RPC `get_invite`, qui renvoie une invitation par token sans exposer toute la table.
- Les promoteurs voient toutes les tables dans l'UI (`canAccessTable`) et peuvent assigner des tables dans la modale.
- Le modele distingue bien `client`, `booker` et `assignedTo` dans le type `ClubTable` et dans les champs UI.
- Le token QR nouvellement genere utilise `crypto.randomUUID()`.
- La correction PWA de nom de fichier est presente : `public/icon-512.png` existe et `manifest.json` pointe vers `/icon-512.png`.
- Le chargement des donnees et l'abonnement realtime sont maintenant gardes par `currentUser`, donc prepares pour RLS/authentifie.
- La closure realtime sur la date active est corrigee via `activeEventDateRef`.

## 3. Partiellement developpe

- Authentification : code pret cote front, mais fonctionnement local/prod depend de Supabase Auth, des comptes crees par `scripts/seed-auth-users.mjs`, de `staff_users.auth_id`, et des variables `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- RLS : migration `0003_phase0b_identity_and_rls.sql` ecrite, mais son application live n'a pas ete verifiee ici et ne doit etre faite qu'apres seed Auth + deploiement + tests.
- Realtime : cable sur `club_tables`, `entry_logs`, `promoter_contacts`, `promoter_guest_entries`, mais chaque evenement refetch toute la table concernee. Instantane pour MVP, fragile sous charge ou pendant grosse soiree.
- Groupes de tables : fonctionnement present, mais le `linked_group_id` technique est encore derive avec `GROUP-${Date.now()}` et des libelles de groupe/table jumelle restent affiches sous forme d'ids de tables. La regle "les identifiants techniques de groupes ne doivent jamais etre affiches" est respectee pour `linked_group_id`, mais l'UX affiche encore "Groupe : T1 + T2" / "Jumelee : ...".
- Depenses : ajout UI present, mais encore par reecriture du tableau `expenses` dans `club_tables`. La RPC atomique `add_expense` est preparee en SQL mais pas branchee dans l'app.
- Archives : `event_archives` recoit un snapshot a la cloture, mais il n'y a pas d'ecran de consultation des archives par date.

## 4. Uniquement prepare

- Modele Lieux/Evenements : migration `0004_events_model.sql` seulement. Elle cree `venues`, `events`, RLS et RPC `public_events()`, mais aucune UI Club One ne consomme ou edite ces tables.
- Plan de communication IA : `COMMS_IA_PLAN.md` seulement. Aucun back office, aucune file de validation, aucune generation, aucun job asynchrone.
- Depense atomique : `0005_atomic_expense.sql` seulement. La fonction SQL n'est pas appelee par `app/page.tsx`.
- Durcissement horizontal promoteurs : documente comme "a tester" dans `0003`, non applique. Aujourd'hui les policies preparees `pc_read` / `pge_read` sont `using (true)` pour tout staff authentifie.
- Offline PWA : non prepare au-dela du manifest. Aucun service worker repere.

## 5. Fonctionne en local vs dependances

Fonctionne localement sans Supabase seulement de facon limitee :

- TypeScript pur : OK.
- Analyse statique de code : possible.

Depend de Supabase / variables :

- Build Next : echoue sans `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Login : depend des comptes Auth `<username>@clubone.local`, de `staff_users.auth_id`, et de la RPC `get_my_profile`.
- Tables, reservations, clients, depenses, entrees/sorties, promoteurs, QR, stats, archives : dependent de Supabase.
- Page invite : depend de `get_invite`.
- RLS : depend de l'application reelle des migrations, non verifiee live dans cet audit.

## 6. Points par domaine demande

1. Build : echec local sans variables Supabase ; avertissement workspace root Turbopack.
2. Typecheck : OK.
3. Lint : echec sur 2 erreurs React Hooks, 9 warnings.
4. Authentification : Supabase Auth codee ; reste a valider avec comptes et variables.
5. Roles et permissions : UI coherente avec les regles principales ; promoteurs voient et assignent toutes les tables. Attention, `canEditTable` existe mais n'est pas utilise, donc certains garde-fous UI ne sont pas centralises.
6. RLS Supabase : policies preparees pour toutes les tables operationnelles. Non confirmees live. Lecture horizontale promoteurs encore permissive dans la migration.
7. Temps reel : present, apres auth, avec correction date active ; refetch complet a chaque changement.
8. Plan de tables : present, seed initial, zones/capacites/statuts. Toujours mono-fichier.
9. Reservations : via etat de table (`client`, `phone`, `people`, `booker`, `eventDate`, `assignedTo`), pas de table `reservations` dediee.
10. Groupes de tables : presents via `linked_tables` / `linked_group_id`, mais pas transactionnels ; ids de tables visibles dans les regroupements.
11. Depenses : present en JSON sur table ; risque de perte concurrente non corrige tant que `add_expense` n'est pas branchee.
12. Clients : vue clients derivee des tables et des contacts promoteurs ; pas de CRM/client canonical dedie.
13. Promoteurs : module contacts + invitations + QR + stats promoteurs present ; liste promoteurs codee en dur (`mathias`, `quentin`, `lawrence`).
14. Serveurs : role `server` present ; visibilite limitee aux tables non assignees ou assignees serveur/Jeremy. Droits RLS preparees autorisent `server` a ecrire `club_tables`.
15. Securite : gros progres vs main, mais depend de l'application Supabase. Risques restants : secrets historiques, brute-force login/QR sans rate-limit, lecture horizontale staff sur PII promoteurs, validation QR non atomique.
16. Entrees/sorties : `entry_logs` present ; policy insert force `staff_username = current_staff_username()` dans la migration. Compteur local par date.
17. QR invitation : generation crypto pour nouveaux QR, page publique via RPC. Validation cote app fait select puis update non atomique ; deux scans simultanes peuvent encore passer si course reseau.
18. Statistiques : CA, entrees/sorties, zones, promoteurs presents en front. Stats derivees de l'etat courant, pas d'entrepot analytique.
19. Archives par date : insertion archive a la cloture, pas de consultation historique par date dans l'UI.
20. PWA : manifest + icones OK ; pas de service worker/offline/cache.
21. Lieux/Evenements : schema SQL/RPC public prepares, aucune UI ni liaison reservations/soiree.
22. Communication IA : cadrage documentaire uniquement, avec bon principe hors chemin temps reel.

## 7. Risques de securite

- RLS non verifiee live dans cet audit : tant que `0003` n'est pas appliquee et testee, les garanties restent theoriques.
- Secrets historiques : les anciens mots de passe ont existe dans Git ; rotation et hygiene historique restent indispensables.
- Login sans rate-limit applicatif documente comme reste ouvert.
- RPC `get_invite` publique : limitee a un token, mais sans rate-limit.
- QR legacy : documents signalent que les anciennes invitations peuvent avoir des tokens faibles.
- Validation QR non atomique : le code lit `checked_in`, puis update. Une fonction SQL conditionnelle `where checked_in = false` ou RPC atomique serait plus sure.
- Policies `pc_read` / `pge_read` permissives : tout staff authentifie peut lire tous les contacts/invites dans la version preparee de `0003`.
- Donnees PII : clients, telephones, invites, notes et CA restent dans tables operationnelles ; politique de retention/RGPD non implementee.

## 8. Risques de regression

- `app/page.tsx` concentre encore presque toute la logique metier et UI : changements risques.
- Realtime par refetch complet peut provoquer des rebonds et latences lors de soirees actives.
- `seedTablesIfNeeded` tente d'inserer les tables si `club_tables` est vide ; sous RLS et en prod, cela donne un comportement a bien cadrer.
- Les fonctions SQL `0004` reutilisent `current_staff_role()` : elles dependent strictement de l'application prealable de `0003`.
- La correction des depenses atomiques demandera de remplacer la logique locale actuelle sans casser l'affichage des totaux/groupe.

## 9. Doublons et dette de logique

- Calculs de totaux/groupe/revenus repartis dans plusieurs fonctions front.
- Roles/verifications presents a la fois dans UI (`canAccessTable`, `BottomNav`, conditions JSX) et en SQL RLS ; c'est normal mais doit rester synchronise.
- `canEditTable` n'est pas utilise alors qu'il exprime un garde-fou metier.
- `AgendaView` et fonctions de calcul par date existent mais ne sont pas branchees.
- Promoteurs listes en dur a plusieurs endroits (`mathias`, `quentin`, `lawrence`).

## 10. Etat exact du modele Lieux/Evenements

Etat : prepare, non integre.

`0004_events_model.sql` cree :

- `venues` avec `eden`, `cercle`, `terminus`
- `events` rattache a `venues`
- indexes par lieu/date et statut/date
- RLS : lecture authentifiee, ecriture admin/manager/promoter
- RPC `public_events()` en `SECURITY DEFINER`, accessible anon/authenticated, ne renvoyant que les evenements publies et futurs

Manquant :

- aucun onglet Club One pour CRUD evenements
- aucun raccord au site
- aucune table `reservations`
- aucun lien entre evenement et plan de tables/archives autre que documents de conception

## 11. Etat exact du temps reel

Etat : cable et corrige partiellement.

Dans `app/page.tsx`, apres authentification :

- abonnement `club_live_realtime`
- `postgres_changes` sur `club_tables`, `entry_logs`, `promoter_contacts`, `promoter_guest_entries`
- refetch complet par table a chaque evenement
- `promoter_guest_entries` refetch la date active via `activeEventDateRef`

Limites :

- pas de diff/merge evenementiel local
- pas de resolution de conflit
- pas d'ecriture atomique pour depense ou check-in QR
- pas d'abonnement aux futures tables `events` / `venues`

Conclusion : suffisant pour MVP, pas encore garanti "instantane pendant les soirees" si l'activite augmente.

## 12. Etat exact du plan de communication IA

Etat : document de cadrage uniquement.

Points positifs :

- IA separee du front office temps reel
- validation humaine obligatoire
- aucun envoi/post autonome
- pas de fausse integration Runway/Midjourney/Adobe Express
- s'appuie sur futur modele `events`

Manquant :

- schema de file de contenu
- UI de validation
- jobs asynchrones
- stockage prompts/briefs/assets
- permissions back office
- integration site/publication

## 13. Cause de la modification `package-lock.json`

Le diff actuel retire 114 lignes correspondant uniquement aux proprietes `libc` de paquets optionnels natifs Linux :

- `@img/sharp-libvips-*`
- `@img/sharp-*`
- `@next/swc-*`
- `@tailwindcss/oxide-*`
- `@unrs/resolver-binding-*`
- `lightningcss-*`

Environnement local releve :

- Node : `v24.14.0`
- npm : `11.9.0`
- `package-lock.json` : `lockfileVersion: 3`

Interpretation : modification mecanique de lockfile par l'environnement npm local, probablement lors d'une installation/resolution avec npm 11, qui normalise ou omet ces champs `libc` sur des dependances optionnelles. Aucune dependance applicative n'est ajoutee ou retiree dans le diff. La modification n'a pas ete supprimee, conformement a la consigne.

## 14. Fonctionnalites manquantes vs objectif

- Application effective et testee de Phase 0b sur Supabase.
- Tests reels par role : admin, manager, server, security, security_counter, promoter.
- Rate limiting login et QR.
- Validation QR atomique.
- Depenses atomiques branchees dans l'app.
- Service worker/offline/file d'attente pour usage en soiree.
- Ecran d'archives par date.
- CRUD Lieux/Evenements dans Club One.
- Raccord site via `public_events()`.
- Reservations dediees et lien reservation -> evenement -> table.
- Back office IA et file de validation humaine.
- Refactor progressif du mono-fichier.
- Tests automatises minimaux sur calculs groupe, depenses, permissions, QR.

## 15. Prochain lot recommande

Ne pas demarrer de grand module maintenant. Lot recommande apres validation de ce rapport :

1. Stabilisation technique courte : fournir env local de test, corriger build sans variables manquantes ou documenter `.env.local`, corriger les 2 erreurs lint sans changer le metier.
2. Verification Supabase Phase 0b en fenetre hors soiree : seed comptes Auth, test login 6 roles, test `/invite`, application `0003`, verification anon bloque/auth OK.
3. Fiabilite soiree : brancher `add_expense` en RPC atomique et rendre le check-in QR atomique.
4. PWA/offline minimal : service worker + strategie cache/app shell + file d'actions critique si reseau instable.
5. Ensuite seulement : UI Evenements + raccord site + comms IA asynchrone.

## 16. Arret

Audit et verifications termines. Aucun nouveau module n'a ete commence.
