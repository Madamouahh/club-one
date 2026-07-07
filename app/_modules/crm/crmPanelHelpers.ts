// app/_modules/crm/crmPanelHelpers.ts — helpers PURS (aucun accès réseau) du panneau fiche client CRM.
// Complète lib/crmProfile (validations/dédup/CSV cellules) avec ce que l'UI a besoin en plus :
//   · parse d'un FICHIER CSV en lignes de cellules (RFC-4180 simplifié : guillemets, virgules, sauts) ;
//   · rapport d'import par ligne (réutilise csvCellsToGuest, saute l'en-tête et les lignes vides) ;
//   · sérialisation CSV d'export (en-tête figé + échappement) — round-trip stable avec crmProfile ;
//   · filtre de recherche (téléphone/email/prénom/nom, insensible casse/accents) ;
//   · MISE EN FORME d'un aperçu de fusion (non destructif : dit QUI serait gardé, ce qui serait rempli,
//     et les conflits) — aucune fusion n'est exécutée ici.
// Tout est déterministe et testable (tests/crmPanel.test.mts).

import {
  GUEST_CSV_COLUMNS,
  csvCellsToGuest,
  guestToCsvCells,
  normalizeEmail,
  type CsvImportError,
  type DuplicateGroup,
  type DuplicateKey,
  type GuestImportFields,
} from "../../../lib/crmProfile.ts";
import { normalizeE164 } from "../../../lib/crmClients.ts";

// ————————————————————————————————————————————————————————————————
// Normalisation de comparaison (minuscule + accents retirés + espaces compactés). Pour la recherche.
// ————————————————————————————————————————————————————————————————

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ————————————————————————————————————————————————————————————————
// Parse CSV — machine à états RFC-4180 simplifiée (délimiteur virgule, guillemets `"` échappés par `""`).
// Gère \r\n et \n. Ne fabrique rien : rend les cellules brutes, la validation est faite en aval.
// ————————————————————————————————————————————————————————————————

export function parseCsv(input: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // retire un BOM éventuel
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAny = false; // au moins un caractère significatif sur la ligne courante
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    sawAny = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      sawAny = true;
    } else if (c === ",") {
      sawAny = true;
      endField();
    } else if (c === "\n") {
      endRow();
    } else if (c === "\r") {
      // ignoré : le \n suivant clôt la ligne (ou fin de fichier gérée plus bas)
    } else {
      sawAny = true;
      field += c;
    }
  }
  // Dernière ligne sans saut final : ne l'ajoute que si elle porte du contenu.
  if (sawAny || field.length > 0 || row.length > 0) {
    endRow();
  }
  return rows;
}

// ————————————————————————————————————————————————————————————————
// Rapport d'import CSV — par ligne : OK (champs normalisés) ou erreurs explicites. Saute en-tête + lignes vides.
// ————————————————————————————————————————————————————————————————

export type CsvRowResult =
  | { line: number; ok: true; value: GuestImportFields }
  | { line: number; ok: false; errors: CsvImportError[]; raw: string[] };

export type CsvImportReport = {
  headerSkipped: boolean;
  rows: CsvRowResult[];
  validCount: number;
  errorCount: number;
};

// Vrai si la 1re ligne EST l'en-tête du contrat (mêmes colonnes, même ordre, insensible à la casse).
export function isHeaderRow(cells: readonly string[]): boolean {
  if (cells.length !== GUEST_CSV_COLUMNS.length) return false;
  return GUEST_CSV_COLUMNS.every((col, i) => (cells[i] ?? "").trim().toLowerCase() === col);
}

function isEmptyRow(cells: readonly string[]): boolean {
  return cells.every((c) => c.trim() === "");
}

export function buildCsvImportReport(parsed: readonly string[][]): CsvImportReport {
  const rows: CsvRowResult[] = [];
  let headerSkipped = false;
  let validCount = 0;
  let errorCount = 0;

  parsed.forEach((cells, idx) => {
    if (isEmptyRow(cells)) return; // ligne vide : ignorée (jamais comptée en erreur)
    if (idx === 0 && isHeaderRow(cells)) {
      headerSkipped = true;
      return;
    }
    const parsedRow = csvCellsToGuest(cells);
    if (parsedRow.ok) {
      validCount++;
      rows.push({ line: idx + 1, ok: true, value: parsedRow.value });
    } else {
      errorCount++;
      rows.push({ line: idx + 1, ok: false, errors: parsedRow.errors, raw: [...cells] });
    }
  });

  return { headerSkipped, rows, validCount, errorCount };
}

// ————————————————————————————————————————————————————————————————
// Export CSV — en-tête figé (GUEST_CSV_COLUMNS) + échappement RFC-4180. Round-trip stable avec parseCsv.
// ————————————————————————————————————————————————————————————————

export function toCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildGuestCsv(rows: readonly GuestImportFields[]): string {
  const header = GUEST_CSV_COLUMNS.join(",");
  const lines = rows.map((r) => guestToCsvCells(r).map(toCsvField).join(","));
  return [header, ...lines].join("\r\n");
}

// ————————————————————————————————————————————————————————————————
// Filtre de recherche — téléphone / email / prénom / nom. Insensible casse + accents. Chiffres pour le tel.
// ————————————————————————————————————————————————————————————————

export type SearchableGuest = {
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string;
};

export function guestMatchesQuery(guest: SearchableGuest, rawQuery: string): boolean {
  const q = fold(rawQuery);
  if (!q) return true;
  const hay = fold([guest.first_name, guest.last_name ?? "", guest.email ?? ""].join(" "));
  if (hay.includes(q)) return true;
  const digits = q.replace(/\D/g, "");
  if (digits) {
    // Rapproche la forme E.164 (+33…) et la forme nationale (0…) : « 0612… » doit trouver « +33612… ».
    const e164 = guest.phone.replace(/\D/g, "");
    const national = e164.startsWith("33") ? `0${e164.slice(2)}` : e164;
    if (`${e164} ${national}`.includes(digits)) return true;
  }
  return false;
}

export function filterGuests<T extends SearchableGuest>(guests: readonly T[], query: string): T[] {
  const q = query.trim();
  if (!q) return [...guests];
  return guests.filter((g) => guestMatchesQuery(g, q));
}

// ————————————————————————————————————————————————————————————————
// Validation d'une date ISO canonique (AAAA-MM-JJ) — miroir de la garde d'import (rejette 2020-02-31).
// ————————————————————————————————————————————————————————————————

export function isIsoDateString(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

// Warn si le téléphone saisi (normalisé) diffère du téléphone courant : c'est la CLÉ de dédup.
export function phoneWouldChange(currentE164: string, rawInput: string): boolean {
  const next = normalizeE164(rawInput);
  if (!next) return false; // saisie invalide : géré ailleurs, pas un « changement »
  return next !== currentE164;
}

// ————————————————————————————————————————————————————————————————
// Aperçu de fusion — NON destructif. Dit QUI serait gardé (fiche la plus ancienne), ce qui serait rempli
// dans les cases vides, et les CONFLITS (valeurs non vides divergentes). Aucune écriture ici.
// ————————————————————————————————————————————————————————————————

export type MergePreviewGuest = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string;
  birthday: string | null;
  created_at: string | null;
};

export type MergeField = "first_name" | "last_name" | "email" | "phone" | "birthday";

const MERGE_FIELDS: MergeField[] = ["first_name", "last_name", "email", "phone", "birthday"];

export type MergeConflict = { field: MergeField; primary: string; incoming: string; incomingId: string };

export type MergePreview = {
  key: DuplicateKey;
  value: string;
  primaryId: string; // fiche conservée
  mergedIds: string[]; // fiches qui seraient repliées dedans
  resulting: Record<MergeField, string | null>; // remplissage non destructif (primaire prioritaire)
  conflicts: MergeConflict[]; // valeurs non vides qui divergent → arbitrage humain requis
};

function fieldValue(g: MergePreviewGuest, field: MergeField): string {
  const v = g[field];
  return v == null ? "" : String(v).trim();
}

function isEmptyVal(v: string): boolean {
  return v.trim() === "";
}

// Prend un groupe candidat (détecté par detectDuplicates) + les fiches par id, rend un aperçu déterministe.
// Fiche primaire = la plus ANCIENNE (created_at) ; à défaut/égalité, id lexicographiquement le plus petit.
export function buildMergePreview(
  group: DuplicateGroup,
  guestsById: ReadonlyMap<string, MergePreviewGuest>,
): MergePreview | null {
  const guests = group.guestIds
    .map((id) => guestsById.get(id))
    .filter((g): g is MergePreviewGuest => g != null);
  if (guests.length < 2) return null;

  const sorted = [...guests].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : Number.POSITIVE_INFINITY;
    const tb = b.created_at ? Date.parse(b.created_at) : Number.POSITIVE_INFINITY;
    const na = Number.isNaN(ta) ? Number.POSITIVE_INFINITY : ta;
    const nb = Number.isNaN(tb) ? Number.POSITIVE_INFINITY : tb;
    if (na !== nb) return na - nb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const primary = sorted[0];
  const others = sorted.slice(1).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const resulting = {} as Record<MergeField, string | null>;
  const conflicts: MergeConflict[] = [];

  for (const field of MERGE_FIELDS) {
    const primaryVal = fieldValue(primary, field);
    let filled = primaryVal;
    for (const o of others) {
      const otherVal = fieldValue(o, field);
      if (isEmptyVal(otherVal)) continue;
      if (isEmptyVal(filled)) {
        filled = otherVal; // case vide du primaire : remplie par la 1re fiche (ordre id) qui a la valeur
      } else if (!isEmptyVal(primaryVal) && otherVal !== primaryVal) {
        conflicts.push({ field, primary: primaryVal, incoming: otherVal, incomingId: o.id });
      }
    }
    resulting[field] = isEmptyVal(filled) ? null : filled;
  }

  return {
    key: group.key,
    value: group.value,
    primaryId: primary.id,
    mergedIds: others.map((o) => o.id),
    resulting,
    conflicts,
  };
}
