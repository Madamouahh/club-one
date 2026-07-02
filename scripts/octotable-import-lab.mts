// scripts/octotable-import-lab.mts — IMPORT RÉEL des clients OctoTable dans le CRM, sur le LABO UNIQUEMENT.
//
// ⚠️ LABO SEULEMENT. Ce script NE se connecte à AUCUNE base : il LIT l'export OctoTable, exécute le
// pipeline PUR (lib/octotableImport.ts) et ÉMET un fichier SQL de chargement idempotent. L'exécution
// réelle est faite à la main contre le conteneur docker du LABO (voir en-tête du SQL généré). L'import
// en PRODUCTION est INTERDIT (règle de gouvernance) — ce script n'a aucun moyen de toucher la prod.
//
// Le SQL généré contient de la VRAIE PII (noms, téléphones) → il est écrit dans le scratchpad de session
// (hors dépôt) et n'est JAMAIS committé. Seul ce générateur (sans PII) et la vérification agrégée le sont.
//
// Choix techniques :
//   · staging TEMPORAIRE tout-texte + COPY … FROM stdin (format pg_dump) : l'échappement CSV natif gère
//     les apostrophes (O'Brien), guillemets, virgules et sauts de ligne dans les champs — AUCUNE
//     concaténation SQL, donc AUCUN risque d'injection sur la PII.
//   · INSERT … SELECT … FROM staging ON CONFLICT (phone) DO NOTHING : idempotent (relancer = 0 insert).
//   · consent_marketing=false par défaut ; opt-in newsletter documenté → true + source + horodatage
//     (preuve CNIL) — miroir exact de buildGuestUpsert. AUCUN client inventé, AUCUN envoi.
//
// Usage :  node scripts/octotable-import-lab.mts [chemin_csv] [chemin_sql_sortie]

import { readFileSync, writeFileSync } from "node:fs";
import { runOctotableDryRun, type GuestUpsertRow } from "../lib/octotableImport.ts";

const DEFAULT_CSV =
  "C:\\Users\\maxou\\club-one-lab\\imports\\octotable_customers_export_2026-07-02.csv";
// Sortie par défaut dans le scratchpad de session (hors dépôt) — le SQL contient de la PII.
const DEFAULT_SQL_OUT =
  "C:\\Users\\maxou\\AppData\\Local\\Temp\\claude\\C--Users-maxou-club-one\\" +
  "e4c944a8-2ada-4359-a5b9-49bafdb9a709\\scratchpad\\octotable-lab-load.sql";

const csvPath = process.argv[2] ?? DEFAULT_CSV;
const sqlOut = process.argv[3] ?? DEFAULT_SQL_OUT;

// ————————————————————————————————————————————————————————————————
// Encodage CSV pour COPY (format csv, null '') : un champ null → vide NON quoté (= NULL) ; un champ
// non-null → toujours quoté, guillemets internes doublés. Cela désambiguïse null vs chaîne vide.
// ————————————————————————————————————————————————————————————————
function csvField(v: string | number | boolean | null): string {
  if (v === null) return ""; // NULL '' : champ vide non quoté = NULL en base
  const s = String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

// Colonnes chargées (miroir de GuestUpsertRow ; owner_promoter/consent_service/birthday/notes = défauts).
const COLS = [
  "phone",
  "first_name",
  "last_name",
  "majorite_verifiee",
  "consent_marketing",
  "consent_marketing_at",
  "consent_source",
  "source",
  "venue",
  "client_historique",
  "first_seen_at",
  "import_no_show",
] as const;

function rowToCsv(r: GuestUpsertRow): string {
  return [
    csvField(r.phone),
    csvField(r.first_name),
    csvField(r.last_name),
    csvField(r.majorite_verifiee), // false
    csvField(r.consent_marketing),
    csvField(r.consent_marketing_at),
    csvField(r.consent_source),
    csvField(r.source),
    csvField(r.venue),
    csvField(r.client_historique), // true
    csvField(r.first_seen_at),
    csvField(r.import_no_show),
  ].join(",");
}

const text = readFileSync(csvPath, "utf8");
const { report, upserts } = runOctotableDryRun(text);

if (!report.headerOk) {
  console.error(`En-tête OctoTable NON conforme : ${report.headerReason}. Import annulé.`);
  process.exit(1);
}

// Garde anti-doublon de téléphone dans le lot (le pipeline dédup déjà par téléphone ; ceinture+bretelles).
const phones = new Set<string>();
for (const r of upserts) {
  if (phones.has(r.phone)) {
    console.error(`Téléphone dupliqué dans le lot d'upsert : ${r.phone}. Import annulé (dédup incohérente).`);
    process.exit(1);
  }
  phones.add(r.phone);
}

const dataLines = upserts.map(rowToCsv).join("\n");

// SQL de chargement : transaction atomique, staging temporaire auto-dropée au commit, COPY inline,
// INSERT idempotent. Tout dans un seul flux stdin (pattern pg_dump : les données suivent COPY, close \.).
const sql = `-- GÉNÉRÉ par scripts/octotable-import-lab.mts — LABO SEULEMENT — CONTIENT DE LA PII, NE PAS COMMITTER.
-- Exécution :  docker exec -i supabase_db_club-one-lab psql -U postgres -d postgres -v ON_ERROR_STOP=1 < <ce_fichier>
\\set ON_ERROR_STOP on
begin;

create temporary table stg_guests_import (
  phone                text,
  first_name           text,
  last_name            text,
  majorite_verifiee    text,
  consent_marketing    text,
  consent_marketing_at text,
  consent_source       text,
  source               text,
  venue                text,
  client_historique    text,
  first_seen_at        text,
  import_no_show       text
) on commit drop;

copy stg_guests_import (${COLS.join(", ")}) from stdin with (format csv, null '');
${dataLines}
\\.

-- Garde : le lot de staging ne doit contenir aucun doublon de téléphone.
do $$
declare d int;
begin
  select count(*) into d from (
    select phone from stg_guests_import group by phone having count(*) > 1
  ) x;
  if d > 0 then raise exception 'staging contient % téléphones dupliqués', d; end if;
end $$;

insert into public.guests (
  phone, first_name, last_name, majorite_verifiee,
  consent_marketing, consent_marketing_at, consent_source,
  source, venue, client_historique, first_seen_at, import_no_show
)
select
  phone,
  first_name,
  nullif(last_name, ''),
  majorite_verifiee::boolean,
  consent_marketing::boolean,
  nullif(consent_marketing_at, '')::timestamptz,
  nullif(consent_source, ''),
  source,
  venue,
  client_historique::boolean,
  nullif(first_seen_at, '')::date,
  nullif(import_no_show, '')::boolean
from stg_guests_import
on conflict (phone) do nothing;

commit;
`;

writeFileSync(sqlOut, sql, "utf8");

// Résumé agrégé (ZÉRO PII).
console.log("═══════════════════════════════════════════════════════════════");
console.log("  GÉNÉRATION SQL D'IMPORT OCTOTABLE — LABO SEULEMENT");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`Source CSV        : ${csvPath}`);
console.log(`SQL généré (PII)  : ${sqlOut}`);
console.log("");
console.log(`Lignes lues                : ${report.rowsRead}`);
console.log(`Personnes uniques          : ${report.uniquePeople}  (doublons fusionnés : ${report.duplicatesMerged})`);
console.log(`Fiches d'upsert (avec tél) : ${upserts.length}`);
console.log(`  · opt-in marketing       : ${upserts.filter((r) => r.consent_marketing).length}`);
console.log(`  · flag no-show           : ${upserts.filter((r) => r.import_no_show).length}`);
console.log(`Non importables (email)    : ${report.notImportableEmailOnly}  → décision fondateur/schéma`);
console.log(`Bloqués (exclus)           : ${report.blockedExcluded}`);
console.log("");
console.log("→ Rien n'a été écrit en base par ce script. Exécuter le SQL généré contre le LABO,");
console.log("  puis lancer scripts/octotable-verify-lab.sql pour la vérification agrégée.");
console.log("═══════════════════════════════════════════════════════════════");
