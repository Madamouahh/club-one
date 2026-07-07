// recompute_maturity.mjs — recalcul DÉTERMINISTE du score de maturité (barème du produit map :
// COMPLETE_AND_UI_PROVEN=100, PARTIAL=50, BACKEND_ONLY=40, FRONTEND_ONLY=25, PLACEHOLDER=15, ABSENT=0).
// Global = somme des poids des 41 sous-fonctionnalités produit (LOTS B→G) ÷ 41 (méthode du map).
// Chaque mise à jour ci-dessous n'est appliquée que si la fonctionnalité est réellement prouvée
// (backend niveau 4 LABO + UI câblée + CLIQUÉE EN NAVIGATEUR). Les cas partiels restent partiels.

const ORIG = {
  B1:100,B2:50,B2b:25,B3:100,B4:100,B5:100,B6:0,B7:0,
  C1:50,C2:100,C3:50,C4:100,C5:50,C6:40,C7:0,
  D1:100,D2:50,D3:40,D4:50,D5:50,D6:100,D7:25,
  E1:100,E2:50,E3:0,E4:40,E5:25,E6:0,
  F1:0,F2:50,F3:50,F4:0,F5:0,F6:0,F7:100,
  G1:50,G2:0,G3:100,G4:50,G5:50,G6:100,
};

// Mises à jour PROUVÉES (Vagues 1→4). Justification = niveau de preuve réel.
const UPDATED = {
  ...ORIG,
  B6: 100, // Tâches : kanban + création CLIQUÉE navigateur (write LABO) ; RLS niveau 4.
  C1: 100, // Agenda mensuel interactif : grille + nav mois prouvées navigateur.
  C7: 50,  // Création soirée : UI éditeur + RPC create/update/dup/cancel niveau 4 ; création non cliquée navigateur → PARTIAL honnête.
  D3: 100, // File de réservation (0025) câblée nav réelle + backend réel, chargée navigateur.
  D7: 100, // Boards Leads/Inbox/Réputation réels (0062-0064 niveau 4) ; Inbox création cliquée navigateur.
  E2: 100, // Préférences + consentements : enregistrement CLIQUÉ navigateur (portail).
  E3: 100, // Agenda mensuel client (Eden/Cercle/Terminus) : filtre + événements prouvés navigateur.
  E6: 100, // Compte client : récupération téléphone+PIN cliquée navigateur, token révocable/expirant, 0061 niveau 4 ; aucune auth permanente.
  F1: 50,  // Audiences/segmentation campagnes : infra 0056 + panneau câblé ; flux audience non cliqué → PARTIAL.
  F4: 50,  // Promo codes : table + panneau ; redemption non cliquée navigateur → PARTIAL.
  F5: 50,  // Messagerie SMS/email/push : file DRY_RUN + outbox, bannière DRY_RUN prouvée navigateur ; aucun envoi réel (par design) → PARTIAL.
  G1: 100, // Rapports promoteurs : identité par rôle réel (staff_roster_v1), heuristique/hardcode supprimés, intégré live.
  G2: 100, // Rapports serveurs : attribution + rapport live, parcours COMPLET (créer→rapport→doublon interdit→retirer) prouvé navigateur.
  // G5 reste 50 : le plan du Cercle n'est PAS validé fondateur (fixture provisoire) — support technique seul.
};

const keys = Object.keys(ORIG);
const sum = (o) => keys.reduce((s, k) => s + o[k], 0);
const oldScore = sum(ORIG) / keys.length;
const newScore = sum(UPDATED) / keys.length;

const changed = keys.filter((k) => ORIG[k] !== UPDATED[k]).map((k) => `${k}: ${ORIG[k]}→${UPDATED[k]}`);
console.log(`Sous-fonctionnalités (LOTS B→G) : ${keys.length}`);
console.log(`Score AVANT : ${oldScore.toFixed(1)} %`);
console.log(`Score APRÈS : ${newScore.toFixed(1)} %`);
console.log(`Delta       : +${(newScore - oldScore).toFixed(1)} pts`);
console.log(`Mises à jour (${changed.length}) : ${changed.join(" · ")}`);
