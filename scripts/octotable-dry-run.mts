// scripts/octotable-dry-run.mts — DRY-RUN d'import OctoTable (LECTURE SEULE, ZÉRO écriture base).
//
// Lit un export base clients OctoTable (CSV « ; »), exécute le pipeline PUR lib/octotableImport.ts,
// et imprime un rapport AGRÉGÉ (aucune PII : ni nom, ni email, ni téléphone). Ne touche à AUCUNE
// base (ni prod ni labo) : c'est un préalable d'audit avant tout import réel.
//
// Usage :  node scripts/octotable-dry-run.mts [chemin_du_csv]
// Défaut : C:\Users\maxou\club-one-lab\imports\octotable_customers_export_2026-07-02.csv

import { readFileSync } from "node:fs";
import { runOctotableDryRun } from "../lib/octotableImport.ts";

const DEFAULT_PATH =
  "C:\\Users\\maxou\\club-one-lab\\imports\\octotable_customers_export_2026-07-02.csv";

const path = process.argv[2] ?? DEFAULT_PATH;
const text = readFileSync(path, "utf8");
const { report, upserts } = runOctotableDryRun(text);

const pct = (n: number, d: number) => (d === 0 ? "—" : `${((100 * n) / d).toFixed(2)} %`);

console.log("═══════════════════════════════════════════════════════════════");
console.log("  DRY-RUN IMPORT OCTOTABLE — lecture seule, aucune écriture base");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`Fichier               : ${path}`);
console.log(`En-tête conforme      : ${report.headerOk ? "OUI" : `NON — ${report.headerReason}`}`);
console.log("");
console.log("── Lecture ────────────────────────────────────────────────────");
console.log(`Lignes de données lues            : ${report.rowsRead}`);
console.log(`  · téléphone normalisable E.164  : ${report.phoneNormalizable} (${pct(report.phoneNormalizable, report.rowsRead)})`);
console.log(`  · téléphone présent mais INVALIDE: ${report.phonePresentButInvalid}`);
console.log(`  · sans téléphone (email seul)   : ${report.phoneAbsent}`);
console.log("");
console.log("── Déduplication (union-find tél PUIS email) ──────────────────");
console.log(`Personnes uniques                 : ${report.uniquePeople}`);
console.log(`Doublons fusionnés                : ${report.duplicatesMerged}`);
console.log("");
console.log("── Import guests (guests.phone NOT NULL) ──────────────────────");
console.log(`IMPORTABLES (uniques avec tél)    : ${report.importable}`);
console.log(`  · dont opt-in marketing (newsl.): ${report.marketingOptIn}`);
console.log(`  · dont flag no-show            : ${report.noShowFlagged}`);
console.log(`NON importables (email seul)      : ${report.notImportableEmailOnly}  → décision fondateur/schéma`);
console.log(`Bloqués (exclus)                  : ${report.blockedExcluded}`);
console.log("");
console.log("── Répartition proxy 1ʳᵉ venue (Date de création) ─────────────");
for (const [year, n] of Object.entries(report.firstSeenByYear).sort()) {
  console.log(`  ${year} : ${n}`);
}
console.log("");
console.log(`Lignes d'upsert guests préparées  : ${upserts.length}`);
console.log("(dry-run : rien n'a été écrit en base)");
console.log("═══════════════════════════════════════════════════════════════");
