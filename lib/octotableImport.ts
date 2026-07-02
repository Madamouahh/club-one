// lib/octotableImport.ts — pipeline PUR d'import de la base clients OctoTable → CRM (guests).
//
// 100 % déterministe, AUCUN accès réseau, AUCUN accès base : ce module lit un texte CSV et produit
// un PLAN d'import + un RAPPORT de dry-run. L'écriture réelle en base est faite par un script séparé
// (scripts/octotable-dry-run.mts pour le rapport ; l'insert lab est une étape distincte et explicite).
//
// Règles dures du chantier (voir IMPORT_OCTOTABLE.md + ANALYSE_EXPORT_OCTOTABLE_2026-07-02.md) :
//   · AUCUN client inventé : on ne mappe QUE ce qui est dans l'export réel du fondateur.
//   · consent_marketing = false PAR DÉFAUT ; exception = les opt-ins newsletter documentés (booléen
//     Newsletter=true + Date d'activation) → consent_marketing=true, source & horodatage = preuve.
//   · Loi Évin : ce module ne compose ni ne stocke AUCUN message. Il ne fait que préparer des fiches.
//   · Minimisation : on n'importe pas les adresses/allergènes/notes libres (hors finalité, souvent vides).
//   · guests.phone est NOT NULL UNIQUE (0013) : une fiche SANS téléphone normalisable n'est PAS
//     importable telle quelle → elle est RAPPORTÉE dans un bucket dédié, jamais silencieusement perdue
//     ni dotée d'un faux numéro.
//
// La sécurité (RLS, dédup autoritaire, consentement) reste côté base ; ce module est un préparateur
// testable, pas une frontière de sécurité.

import { normalizeE164, isE164 } from "./crmClients.ts";

// ————————————————————————————————————————————————————————————————
// Constantes de provenance (miroir des colonnes 0017) — jamais de valeur « magique » dispersée.
// ————————————————————————————————————————————————————————————————
export const OCTOTABLE_SOURCE = "octotable" as const;
export const OCTOTABLE_VENUE = "eden" as const;
export const OCTOTABLE_NEWSLETTER_CONSENT_SOURCE = "octotable_newsletter" as const;

// En-tête ATTENDU de l'export base clients OctoTable (délimiteur « ; », UTF-8). L'ordre réel est
// vérifié à l'exécution (assertHeader) : si OctoTable change ses colonnes, on refuse plutôt que de
// mapper à l'aveugle sur un mauvais index.
export const OCTOTABLE_EXPECTED_HEADER = [
  "Prénom",
  "Nom",
  "Email",
  "Téléphone",
  "Préfixe",
  "Date de création",
  "Langue",
  "Bloqué",
  "Visible",
  "No show",
  "Allergènes",
  "Types de profil",
  "Attributs marketing",
  "Newsletter",
  "Date d'activation newsletter",
  "Notes",
  "Adresse",
  "Ville",
  "Code postal",
  "Département",
  "Pays",
  "Notes d'adresse",
] as const;

// ————————————————————————————————————————————————————————————————
// 1) Parsing CSV robuste (RFC 4180-ish, délimiteur « ; »).
//    Gère : BOM UTF-8, CRLF/LF, champs entre guillemets, guillemets échappés (""), délimiteurs et
//    sauts de ligne DANS un champ guillemeté. Ne suppose PAS que les notes/adresses sont vides.
// ————————————————————————————————————————————————————————————————
export function parseDelimited(text: string, delimiter = ";"): string[][] {
  const rows: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  // Retire un éventuel BOM UTF-8 en tête.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++; // guillemet échappé ""
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
    } else if (c === delimiter) {
      record.push(field);
      field = "";
    } else if (c === "\n") {
      record.push(field);
      field = "";
      rows.push(record);
      record = [];
    } else if (c === "\r") {
      // ignoré : le \n suivant clôt l'enregistrement (CRLF) ; un \r seul est toléré.
    } else {
      field += c;
    }
  }
  // Dernier champ / dernier enregistrement s'il n'y a pas de saut de ligne final.
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    rows.push(record);
  }
  return rows;
}

export function assertOctotableHeader(header: string[]): { ok: boolean; reason?: string } {
  const norm = (s: string) => s.trim();
  if (header.length < OCTOTABLE_EXPECTED_HEADER.length) {
    return { ok: false, reason: `colonnes manquantes (${header.length} < ${OCTOTABLE_EXPECTED_HEADER.length})` };
  }
  for (let i = 0; i < OCTOTABLE_EXPECTED_HEADER.length; i++) {
    if (norm(header[i]) !== OCTOTABLE_EXPECTED_HEADER[i]) {
      return { ok: false, reason: `colonne ${i + 1} = « ${norm(header[i])} », attendu « ${OCTOTABLE_EXPECTED_HEADER[i]} »` };
    }
  }
  return { ok: true };
}

// ————————————————————————————————————————————————————————————————
// 2) Normalisation du téléphone : OctoTable stocke le préfixe pays (« +33 ») SÉPARÉ du numéro.
//    On combine intelligemment puis on valide (E.164). Aucun numéro fabriqué : null si non normalisable.
// ————————————————————————————————————————————————————————————————
export function normalizeOctotablePhone(prefix: string, phone: string): string | null {
  const p = (phone ?? "").trim();
  if (!p) return null;

  // Numéro déjà international dans la colonne téléphone : il se suffit à lui-même (le préfixe est ignoré).
  if (p.startsWith("+")) return normalizeE164(p);

  const digits = p.replace(/[^0-9]/g, "");
  if (!digits) return null; // ex. « F… » (saisie non numérique) → non normalisable, pas inventé.

  const pref = (prefix ?? "").trim();
  if (pref.startsWith("+")) {
    const prefDigits = pref.replace(/[^0-9]/g, "");
    if (!prefDigits) return normalizeE164(digits, "FR");
    // Format national (préfixe 0) → on retire le 0 avant d'accoler l'indicatif pays.
    const local = digits.startsWith("0") ? digits.slice(1) : digits;
    if (!local) return null;
    const candidate = `+${prefDigits}${local}`;
    return isE164(candidate) ? candidate : null;
  }

  // Pas de préfixe exploitable : on retombe sur la normalisation FR par défaut (0X… / 9 chiffres…).
  return normalizeE164(p, "FR");
}

// ————————————————————————————————————————————————————————————————
// 3) Mapping d'une ligne OctoTable → fiche candidate (avant dédup).
// ————————————————————————————————————————————————————————————————
export type OctotableCandidate = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null; // normalisé E.164, ou null si non normalisable/absent
  phonePresentButInvalid: boolean; // téléphone renseigné mais non normalisable
  newsletter: boolean;
  newsletterAt: string | null; // Date d'activation newsletter (ISO), preuve du consentement
  noShow: boolean;
  blocked: boolean;
  firstSeenAt: string | null; // Date de création (ISO date), proxy 1ʳᵉ venue
};

const truthy = (v: string) => (v ?? "").trim().toLowerCase() === "true";
const cleanDate = (v: string): string | null => {
  const t = (v ?? "").trim();
  if (!t) return null;
  // On ne garde que la partie date ISO (YYYY-MM-DD) si un horaire suit ; aucune date fabriquée.
  const m = t.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

export function mapOctotableRow(cols: string[]): OctotableCandidate {
  const get = (i: number) => (cols[i] ?? "").trim();
  const prefix = get(4);
  const rawPhone = get(3);
  const phone = normalizeOctotablePhone(prefix, rawPhone);
  return {
    firstName: get(0),
    lastName: get(1),
    email: get(2),
    phone,
    phonePresentButInvalid: rawPhone.length > 0 && phone === null,
    newsletter: truthy(get(13)),
    newsletterAt: cleanDate(get(14)),
    noShow: truthy(get(9)),
    blocked: truthy(get(7)),
    firstSeenAt: cleanDate(get(5)),
  };
}

export function parseOctotableCustomers(
  text: string,
): { header: string[]; headerCheck: { ok: boolean; reason?: string }; candidates: OctotableCandidate[] } {
  const rows = parseDelimited(text, ";").filter((r) => r.some((c) => (c ?? "").trim() !== ""));
  if (rows.length === 0) {
    return { header: [], headerCheck: { ok: false, reason: "fichier vide" }, candidates: [] };
  }
  const header = rows[0];
  const headerCheck = assertOctotableHeader(header);
  const candidates = rows.slice(1).map(mapOctotableRow);
  return { header, headerCheck, candidates };
}

// ————————————————————————————————————————————————————————————————
// 4) Déduplication union-find « téléphone PUIS email » (transitive) :
//    deux fiches partageant un même téléphone normalisé, OU un même email (insensible à la casse),
//    sont la MÊME personne. Robuste aux fautes de frappe croisées (même tél / email différent, et
//    inversement). Chaque composante connexe = 1 personne unique.
// ————————————————————————————————————————————————————————————————
export type MergedGuest = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  newsletter: boolean;
  newsletterAt: string | null;
  noShow: boolean;
  blocked: boolean;
  firstSeenAt: string | null;
  mergedCount: number; // nombre de fiches source fusionnées
};

const emailKey = (email: string) => {
  const e = (email ?? "").trim().toLowerCase();
  return e ? `email:${e}` : null;
};
const phoneKey = (phone: string | null) => (phone ? `phone:${phone}` : null);

// earliest ISO date (chaîne triable) ; null-safe.
const minDate = (a: string | null, b: string | null): string | null => {
  if (a === null) return b;
  if (b === null) return a;
  return a <= b ? a : b;
};

export function dedupeCandidates(candidates: OctotableCandidate[]): MergedGuest[] {
  const parent: number[] = candidates.map((_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const next = parent[x];
      parent[x] = r;
      x = next;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  // Lier par clé partagée (téléphone, puis email).
  const seen = new Map<string, number>();
  for (let i = 0; i < candidates.length; i++) {
    for (const key of [phoneKey(candidates[i].phone), emailKey(candidates[i].email)]) {
      if (!key) continue;
      const prev = seen.get(key);
      if (prev === undefined) seen.set(key, i);
      else union(prev, i);
    }
  }

  // Regrouper puis fusionner chaque composante en une fiche unique.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < candidates.length; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }

  const merged: MergedGuest[] = [];
  for (const idxs of groups.values()) {
    // Ordre stable = ordre du fichier ; le premier non-vide gagne pour les champs identitaires.
    const firstNonEmpty = (pick: (c: OctotableCandidate) => string) => {
      for (const i of idxs) {
        const v = pick(candidates[i]).trim();
        if (v) return v;
      }
      return "";
    };
    let phone: string | null = null;
    let newsletter = false;
    let newsletterAt: string | null = null;
    let noShow = false;
    let blocked = false;
    let firstSeenAt: string | null = null;
    for (const i of idxs) {
      const c = candidates[i];
      if (phone === null && c.phone) phone = c.phone;
      if (c.newsletter) {
        newsletter = true;
        // On garde la PLUS ANCIENNE date d'activation avérée (preuve du 1er opt-in).
        newsletterAt = minDate(newsletterAt, c.newsletterAt);
      }
      if (c.noShow) noShow = true;
      if (c.blocked) blocked = true;
      firstSeenAt = minDate(firstSeenAt, c.firstSeenAt); // proxy 1ʳᵉ venue = la plus ancienne création
    }
    merged.push({
      firstName: firstNonEmpty((c) => c.firstName),
      lastName: firstNonEmpty((c) => c.lastName),
      email: firstNonEmpty((c) => c.email),
      phone,
      newsletter,
      newsletterAt,
      noShow,
      blocked,
      firstSeenAt,
      mergedCount: idxs.length,
    });
  }
  return merged;
}

// ————————————————————————————————————————————————————————————————
// 5) Construction de la ligne d'upsert guests (uniquement pour les fiches IMPORTABLES = avec tél).
//    Les fiches sans téléphone (guests.phone NOT NULL) ne produisent PAS de ligne ici.
// ————————————————————————————————————————————————————————————————
export type GuestUpsertRow = {
  phone: string; // garanti non-null ici
  first_name: string;
  last_name: string | null;
  majorite_verifiee: false; // non vérifiable depuis cet export (pas de date de naissance) — honnête
  consent_marketing: boolean;
  consent_marketing_at: string | null;
  consent_source: string | null;
  owner_promoter: null; // clientèle de l'établissement, pas d'un promoteur
  source: string;
  venue: string;
  client_historique: true;
  first_seen_at: string | null;
  import_no_show: boolean;
};

export function buildGuestUpsert(g: MergedGuest): GuestUpsertRow | null {
  if (!g.phone) return null; // non importable tel quel (voir bucket dédié du rapport)
  if (g.blocked) return null; // fiche « Bloqué » : jamais importée (exclusion source respectée)
  const optIn = g.newsletter; // seul l'opt-in newsletter documenté ouvre consent_marketing
  return {
    phone: g.phone,
    first_name: g.firstName || "—", // prénom obligatoire (NOT NULL) ; « — » si l'export ne le fournit pas
    last_name: g.lastName || null,
    majorite_verifiee: false,
    consent_marketing: optIn,
    consent_marketing_at: optIn ? g.newsletterAt : null,
    consent_source: optIn ? OCTOTABLE_NEWSLETTER_CONSENT_SOURCE : null,
    owner_promoter: null,
    source: OCTOTABLE_SOURCE,
    venue: OCTOTABLE_VENUE,
    client_historique: true,
    first_seen_at: g.firstSeenAt,
    import_no_show: g.noShow,
  };
}

// ————————————————————————————————————————————————————————————————
// 6) Rapport de dry-run — chiffres agrégés (ZÉRO PII). « No silent caps » : chaque bucket est exposé.
// ————————————————————————————————————————————————————————————————
export type DryRunReport = {
  headerOk: boolean;
  headerReason?: string;
  rowsRead: number;
  phoneNormalizable: number;
  phonePresentButInvalid: number;
  phoneAbsent: number;
  uniquePeople: number;
  duplicatesMerged: number;
  importable: number; // uniques avec un téléphone → insérables dans guests
  notImportableEmailOnly: number; // uniques sans téléphone (email seul) → décision fondateur/schéma
  blockedExcluded: number; // uniques marqués « Bloqué » (exclus de l'import)
  marketingOptIn: number; // uniques importables avec newsletter opt-in documenté
  noShowFlagged: number; // uniques importables avec flag no-show
  firstSeenByYear: Record<string, number>; // répartition proxy 1ʳᵉ venue par année
};

export function buildDryRunReport(
  candidates: OctotableCandidate[],
  merged: MergedGuest[],
  headerCheck: { ok: boolean; reason?: string },
): DryRunReport {
  const rowsRead = candidates.length;
  const phoneNormalizable = candidates.filter((c) => c.phone !== null).length;
  const phonePresentButInvalid = candidates.filter((c) => c.phonePresentButInvalid).length;
  const phoneAbsent = candidates.filter(
    (c) => c.phone === null && !c.phonePresentButInvalid,
  ).length;

  const importableGuests = merged.filter((g) => g.phone !== null && !g.blocked);
  const firstSeenByYear: Record<string, number> = {};
  for (const g of importableGuests) {
    const year = g.firstSeenAt ? g.firstSeenAt.slice(0, 4) : "inconnu";
    firstSeenByYear[year] = (firstSeenByYear[year] ?? 0) + 1;
  }

  return {
    headerOk: headerCheck.ok,
    headerReason: headerCheck.reason,
    rowsRead,
    phoneNormalizable,
    phonePresentButInvalid,
    phoneAbsent,
    uniquePeople: merged.length,
    duplicatesMerged: rowsRead - merged.length,
    importable: importableGuests.length,
    notImportableEmailOnly: merged.filter((g) => g.phone === null && !g.blocked).length,
    blockedExcluded: merged.filter((g) => g.blocked).length,
    marketingOptIn: importableGuests.filter((g) => g.newsletter).length,
    noShowFlagged: importableGuests.filter((g) => g.noShow).length,
    firstSeenByYear,
  };
}

// Pipeline complet, du texte au rapport (utilisé par le script de dry-run et par les tests).
export function runOctotableDryRun(text: string): {
  report: DryRunReport;
  merged: MergedGuest[];
  upserts: GuestUpsertRow[];
} {
  const { headerCheck, candidates } = parseOctotableCustomers(text);
  const merged = dedupeCandidates(candidates);
  const report = buildDryRunReport(candidates, merged, headerCheck);
  const upserts = merged.map(buildGuestUpsert).filter((r): r is GuestUpsertRow => r !== null);
  return { report, merged, upserts };
}
