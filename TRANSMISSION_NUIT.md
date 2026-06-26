# Transmission — nuit du 2026-06-26 (travail autonome)

Bonjour Maxime. Voici ce qui a été fait cette nuit, ce qui est **sûr**, ce qui est **préparé mais
non déployé**, et **tes prochaines actions dans l'ordre**. Rien n'a été poussé en production ni
appliqué à ta base sans que ce soit listé ici. Tout le code est sur des **branches locales** à relire.

---

## 0. En une minute
- 🔴 **Sécurité** : ta base était **grande ouverte** (n'importe qui pouvait lire les mots de passe en
  clair + les PII clients, et **supprimer/modifier toutes les données**). **Une fuite est déjà
  fermée** : tu as verrouillé `staff_users` (vérifié : anon = 401). Le **reste** (fermer toutes les
  tables proprement) est **codé et prêt** sur la branche `security/phase0b`, à appliquer avec moi.
- 🟢 **Site** : un **prototype complet et ouvrable** du nouveau site (3 univers, identités distinctes,
  mobile, contenu vérifié) est dans **`C:\Users\maxou\larche-site`**.
- 🟢 **Boucle** : modèle Lieux/Événements préparé pour connecter Club One ↔ site.
- ⚠️ **1 décision de marque bloquante** : « Le Cercle » n'existe nulle part en ligne (le site dit
  encore « Le Culte », un restaurant). À trancher avant toute mise en ligne (voir §3).

---

## 1. Sécurité Club One — l'essentiel

**Constat vérifié (audit live)** : aucune RLS. Les 6 tables étaient lisibles ET inscriptibles par
n'importe quel anonyme via la clé publique présente dans le bundle. `staff_users` exposait la colonne
`password` en clair. Détail : `AUDIT_CLUB_ONE.md` §0bis.

**Déjà fait** : verrou d'urgence sur `staff_users` (RLS + revoke anon). Les mots de passe ne sont plus
lisibles. ✅

**Préparé (branche `security/phase0b`, 5 commits, build + typecheck verts, NON déployé)** :
- **Lot 0** : suppression des mots de passe en dur du code (ils restent dans l'historique git → à
  considérer comme compromis).
- **Phase 0b** : vraie identité via **Supabase Auth** + **RLS par rôle sur toutes les tables** + RPC
  `get_invite` (page publique d'invitation sans exposer la table). Revu par 3 angles adversariaux
  (verdict GO_AVEC_CORRECTIFS) ; correctifs appliqués, dont un **bug critique** (sinon écran vide
  après login sous RLS).

### ⚠️ Ordre d'application (voir `SECURITY_PHASE0B.md`) — à faire hors soirée, avec sauvegarde
1. Remplir `scripts/staff-passwords.local.json` (nouveaux mots de passe forts) puis lancer
   `node scripts/seed-auth-users.mjs` (avec ta clé service_role) → crée les comptes Auth.
2. Merger `security/phase0b` → déployer → **tester le login des 6 rôles** + la page `/invite`.
3. **Seulement après**, exécuter `supabase/migrations/0003_phase0b_identity_and_rls.sql` (ferme l'accès
   anonyme). Appliquer 0003 avant le déploiement casserait l'app.
> Je peux te guider pas à pas sur chacune de ces étapes.

---

## 2. Site L'Arche (Priorité 1) — `C:\Users\maxou\larche-site`
Prototype **ouvrable** (double-clic `index.html`, ou `node server.mjs`). 4 pages, **3 identités
visuelles distinctes** (Éden sunset / Le Cercle oxblood rétro chic / Terminus néon urbain), mobile-first,
**vrais CTA** (téléphone, email, réseaux — aucune fausse donnée). Captures faites et validées.
- Contenu **issu d'une recherche web vérifiée** (histoire « La Cheminote », horaires, contacts, socials,
  concurrence). Détails + faits sourcés : `larche-site/README.md`.
- **Recommandation garder-WP-vs-reconstruire** : reconstruire un front moderne (type ce prototype) +
  Club One comme source des événements, garder OctoTable au début, rediriger les URL WP (SEO).
  Décision **finale après audit de ton admin WordPress** (accès non encore fourni).

---

## 3. ⚠️ Décision bloquante : « Le Cercle »
La recherche (site officiel, presse, annuaires, billetteries) montre qu'au 26/06/2026, ton 3ᵉ espace
est encore **« Le Culte », un restaurant** ; « Le Cercle » n'apparaît **nulle part**. Avant de publier
quoi que ce soit sous « Le Cercle » : confirme (1) qu'il remplace Le Culte, (2) qu'il n'est plus un
restaurant, (3) le sort de l'offre resto. La page `cercle.html` est marquée « à valider ».

---

## 4. Préparé pour la suite (non déployé)
- **Boucle / Événements** (`0004_events_model.sql`, `EVENTS_ET_BOUCLE.md`) : tables `venues`+`events`
  + RPC `public_events()` pour que le site lise les soirées créées dans Club One.
- **Fiabilité Club One (Lot 2)** : icône PWA 512 corrigée ✅ ; closure realtime corrigée ✅ ;
  **ajout de dépense atomique** (`0005_atomic_expense.sql`) prêt à brancher (tue la perte de CA quand
  deux serveurs saisissent en même temps — le risque n°1 du cahier des charges).
- **Comms IA (Priorité 2)** : cadrage `COMMS_IA_PLAN.md` (briefs/prompts par univers, validation
  humaine, zéro envoi auto, zéro intégration simulée).

---

## 5. Tes prochaines actions (par ordre)
1. **Sécurité d'abord** : on applique Phase 0b ensemble (étapes §1) dans une fenêtre hors soirée.
2. **Décision « Le Cercle »** (§3) — débloque la mise en ligne du site.
3. **Accès admin WordPress** → je boucle l'audit du site et on choisit garder/reconstruire.
4. Regarder le prototype (`larche-site`) et me dire ce qui te plaît / ce qu'on ajuste.
5. Fournir les **médias + line-ups + horaires/tarifs définitifs** (liste dans `larche-site/README.md`).

## 6. Carte des livrables
- `C:\Users\maxou\club-one` (branche **security/phase0b**) : Lot 0, Phase 0b, durcissements, Lot 2,
  modèle Événements, plans. Docs : `AUDIT_CLUB_ONE.md`, `SECURITY_LOT0.md`, `SECURITY_PHASE0B.md`,
  `EVENTS_ET_BOUCLE.md`, `COMMS_IA_PLAN.md`, ce fichier.
- `C:\Users\maxou\larche-site` (git local) : prototype site + `README.md` (contenu + reco).

## 7. Limites assumées
- Rien n'est déployé/poussé : Phase 0b exige des changements Supabase coordonnés + tests, à faire
  avec toi (tu dors). Pas de migration destructive lancée. Audit WordPress incomplet (pas d'accès admin).
- Durcissements RLS secondaires (lecture horizontale du téléphone entre staff) **documentés mais non
  appliqués** car risqués à figer sans test live (détail dans `SECURITY_PHASE0B.md`).
