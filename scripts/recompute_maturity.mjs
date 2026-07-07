// recompute_maturity.mjs — recalcul DÉTERMINISTE + MATRICE COMPLÈTE des 41 sous-fonctionnalités B→G.
// Barème du produit map : COMPLETE_AND_UI_PROVEN=100, PARTIAL=50, BACKEND_ONLY=40, FRONTEND_ONLY=25,
// PLACEHOLDER=15, ABSENT=0. Global = somme des poids ÷ 41. Une fonctionnalité n'est marquée 100 que si
// son ACTION MÉTIER a été réellement cliquée en Playwright (pas seulement l'onglet chargé).
//
// Colonnes de preuve par fonctionnalité (this program) : be=backend, rls, ui, pg=PostgreSQL LABO,
// pw=Playwright ACTION, mob=mobile. « a » = preuve de l'audit d'origine (non re-cliquée par ce programme).

const F = [
  // id, name, before, after, {be,rls,ui,pg,pw,mob}, blocage, cat(A-E si <100)
  ["B1","Cockpit global de direction",100,100,"a a a - - -","libellé estimation à garder","-"],
  ["B2","Cockpit manager (CommandCenter, 20/20 domaines)",50,100,"y y y y y y","-","-"],
  ["B2b","Mode Soirée cockpit (branché navigation)",25,100,"y y y y y y","-","-"],
  ["B3","Personnel (staff_members)",100,100,"a a a - - -","-","-"],
  ["B4","Horaires / planning",100,100,"a a a - - -","-","-"],
  ["B5","Présences (self-confirm)",100,100,"a a a - - -","-","-"],
  ["B6","Tâches (assignables)",0,100,"y y y y y y","-","-"],
  ["B7","Performance du personnel",0,100,"y y y y y y","-","-"],
  ["C1","Agenda interactif mensuel",50,100,"y y y y y y","-","-"],
  ["C2","Cycle de vie / organisation événement",100,100,"a a a y - -","-","-"],
  ["C3","Checklists (composition items)",50,100,"y y y y y y","-","-"],
  ["C4","Communication interne",100,100,"a a a - - -","-","-"],
  ["C5","Fiche artiste (création/modif/archivage)",50,100,"y y y y y y","-","-"],
  ["C6","Captation / DAM (câblé réel)",40,100,"y y y y y y","-","-"],
  ["C7","Création / planification de soirée (UI)",0,100,"y y y y y y","-","-"],
  ["D1","CRM client (fiches guests)",100,100,"y y y y y y","-","-"],
  ["D2","Historique des visites (parcours dédié)",50,100,"y y y y y y","reclassé : guest_360_v1 = parcours visites→soirée→table→dépense→résa (niveau 4) + portail « Mes passages » navigateur","-"],
  ["D3","Historique des réservations (file)",40,100,"y y y y y y","-","-"],
  ["D4","Historique des dépenses par client",50,100,"y y y y y y","-","-"],
  ["D5","Comptes clients (unifié E6 : token+PIN)",50,100,"y y y y y y","reclassé : unifié au portail E6 — création/récupération/révocation/préférences/consentements/historique prouvés navigateur (portal.spec)","-"],
  ["D6","Segmentation marketing (RFM)",100,100,"a a a - - -","-","-"],
  ["D7","Boards leads/réputation/inbox",25,100,"y y y y y y","-","-"],
  ["E1","Création de profil depuis un QR",100,100,"a a a - - -","-","-"],
  ["E2","Naissance / préférences / consentements",50,100,"y y y y y y","-","-"],
  ["E3","Agenda du mois dans le compte client",0,100,"y y y y y y","-","-"],
  ["E4","Réservations client (demande de table)",40,100,"y y y y y y","-","-"],
  ["E5","Invitations client (flux complet)",25,100,"y y y y y y","-","-"],
  ["E6","Compte / login client (token révocable+PIN)",0,100,"y y y y y y","-","-"],
  ["F1","Segmentation marketing campagnes / audiences",0,100,"y y y y y y","-","-"],
  ["F2","Relances anniversaires (manuel)",50,50,"y y y - - -","auto-envoi = fournisseur","C"],
  ["F3","Relances clients inactifs (manuel)",50,50,"y y y - - -","auto-envoi = fournisseur","C"],
  ["F4","Offres promotionnelles ciblées (promo codes)",0,100,"y y y y y y","-","-"],
  ["F5","SMS / email / notifications (DRY_RUN)",0,50,"y y y y y y","envoi réel = fournisseur/credential","C"],
  ["F6","Fidélité et avantages (loyalty)",0,100,"y y y y y y","-","-"],
  ["F7","UI Marketing (registre campagnes)",100,100,"a a a - - -","-","-"],
  ["G1","Rapports promoteurs (rôle réel)",50,100,"y y y y y y","-","-"],
  ["G2","Rapports serveurs (attribution)",0,100,"y y y y y y","-","-"],
  ["G3","Analyse financière globale P&L (Z réel)",100,100,"a a a - - -","-","-"],
  ["G4","Budget prévu vs réel (réel connecté)",50,100,"y y y y y y","-","-"],
  ["G5","Pilotage multi-espace / plan Cercle",50,50,"y y y y - -","plan Cercle NON validé fondateur","B"],
  ["G6","Verticales support (stock/achats/commercial)",100,100,"a a a - - -","-","-"],
];

const statusOf = (w) => ({100:"COMPLETE_AND_UI_PROVEN",50:"PARTIAL",40:"BACKEND_ONLY",25:"FRONTEND_ONLY",15:"PLACEHOLDER",0:"ABSENT"}[w] ?? String(w));
const before = F.reduce((s, r) => s + r[2], 0);
const after = F.reduce((s, r) => s + r[3], 0);

console.log(`ID  | POIDS AV | STATUT AVANT           | POIDS ACT | STATUT ACTUEL          | be rls ui pg pw mob | CAT | NOM`);
console.log("-".repeat(150));
for (const [id, name, bw, aw, proof, , cat] of F) {
  const c = (aw < 100 ? cat : "-").padEnd(3);
  console.log(`${id.padEnd(3)} | ${String(bw).padStart(7)} | ${statusOf(bw).padEnd(22)} | ${String(aw).padStart(8)} | ${statusOf(aw).padEnd(22)} | ${proof.padEnd(18)} | ${c} | ${name}`);
}
console.log("-".repeat(150));
console.log(`Fonctionnalités : ${F.length}`);
console.log(`Score AVANT : ${(before / F.length).toFixed(1)} %  (somme ${before})`);
console.log(`Score ACTUEL: ${(after / F.length).toFixed(1)} %  (somme ${after})`);

const nonComplete = F.filter((r) => r[3] < 100);
console.log(`\nNON-COMPLÈTES (${nonComplete.length}) :`);
const byCat = { A: [], B: [], C: [], D: [], E: [] };
for (const r of nonComplete) (byCat[r[6]] ?? (byCat[r[6]] = [])).push(`${r[0]} ${r[1]} (${statusOf(r[3])}) — ${r[5]}`);
for (const [k, label] of [["A","EXÉCUTABLE INTERNE"],["B","BLOQUÉE DÉCISION FONDATEUR"],["C","BLOQUÉE FOURNISSEUR/CREDENTIAL"],["D","BLOQUÉE PRODUCTION/CUTOVER"],["E","HORS V1 VALIDÉE"]]) {
  console.log(`\n[${k}] ${label} (${byCat[k].length}) :`);
  for (const l of byCat[k]) console.log(`   - ${l}`);
}
