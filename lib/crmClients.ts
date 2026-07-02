// lib/crmClients.ts — logique PURE du module CRM CLIENTS VIP (V0/V1). Aucun accès réseau.
// Transforme les lignes de la vue guest_scores (migration 0013) en SEGMENTS actionnables, prépare
// des liens wa.me que L'HUMAIN clique (jamais d'envoi automatisé), et verrouille deux points durs
// LÉGAUX en code testable :
//   1. Loi ÉVIN — aucun message sortant ne doit mentionner l'alcool (sanction 75 000 €). La garde
//      `checkMessageEvin` refuse tout texte contenant un terme d'alcool, avant même de bâtir le lien.
//   2. RGPD/CNIL — consentement DÉGROUPÉ (service ≠ marketing) avec le TEXTE EXACT présenté, et STOP
//      définitif : un lien de prospection n'est jamais préparé pour un client opt-out ou non consentant.
//
// Rien n'est inventé : la base ship VIDE (crmDataReady reflète l'état réel), aucun VIP n'est fabriqué
// tant que la cohorte est trop petite pour un seuil top-10 % honnête, aucun coût/dépense n'est simulé.
// L'accès Supabase reste dans app/page.tsx (comme caisse_z / staff_shifts / soiree_charges).

// ————————————————————————————————————————————————————————————————
// Modèle (miroir de la vue guest_scores 0013 + de la table guests)
// ————————————————————————————————————————————————————————————————

export const GUEST_UNIVERS = ["eden", "cercle", "terminus"] as const;
export type GuestUnivers = (typeof GUEST_UNIVERS)[number];

export const VISIT_STATUSES = ["booked", "confirmed", "seated", "no_show", "cancelled"] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

// Une ligne de la vue guest_scores (déjà agrégée côté SQL). spend/last peuvent être null (jamais 0 inventé).
export type GuestScoreRow = {
  guest_id: string;
  first_name: string;
  last_name: string | null;
  owner_promoter: string | null;
  last_seated_date: string | null; // ISO date (YYYY-MM-DD) de la dernière venue « seated »
  visits_seated_90d: number;
  visits_seated_180d: number;
  visits_seated_12m: number;
  spend_seated_12m: number | null; // dépense identifiée sur 12 mois ; null si jamais attribuée
  visits_seated_total: number;
  no_shows_total: number;
  visits_resolved_total: number; // seated + no_show (dénominateur du taux de no-show)
  avg_party_size: number | null;
  univers_prefere: GuestUnivers | null;
};

// Champ additionnel (table guests) utile au segment « anniversaire », hors vue.
export type GuestBirthday = { guest_id: string; birthday: string | null };

// ————————————————————————————————————————————————————————————————
// Consentement — TEXTES EXACTS de la spec (MODULE_CRM_CLIENTS_VIP.md §V0).
// Placeholders {{…}} = données du fondateur (raison sociale légale, cadence, lien politique).
// Tant qu'une valeur manque, le placeholder RESTE visible : on n'invente jamais un nom d'établissement.
// ————————————————————————————————————————————————————————————————

export const CONSENT_SERVICE_TEMPLATE =
  "J'accepte de recevoir par WhatsApp les confirmations liées à ma réservation (table prête, horaires, accès) de la part de {{raison_sociale}}.";

export const CONSENT_MARKETING_TEMPLATE =
  "J'accepte de recevoir par WhatsApp les invitations aux soirées et l'agenda mensuel de {{raison_sociale}} — max {{max}} messages/mois. Désinscription à tout moment en répondant STOP. Données conservées 3 ans après mon dernier contact. {{lien}}";

export type ConsentValues = {
  raisonSociale?: string | null; // raison sociale LÉGALE (donnée fondateur, jamais devinée)
  maxParMois?: number | null; // cadence marketing annoncée
  lienPolitique?: string | null; // URL politique de confidentialité
};

// Remplit un gabarit avec les vraies valeurs ; laisse le {{token}} visible si la valeur manque
// (état vide HONNÊTE — le front peut alors demander la donnée au fondateur, pas la fabriquer).
export function fillConsentText(template: string, values: ConsentValues): string {
  return template
    .replace(
      "{{raison_sociale}}",
      values.raisonSociale && values.raisonSociale.trim()
        ? values.raisonSociale.trim()
        : "{{raison_sociale}}",
    )
    .replace(
      "{{max}}",
      values.maxParMois != null && values.maxParMois > 0 ? String(values.maxParMois) : "{{max}}",
    )
    .replace(
      "{{lien}}",
      values.lienPolitique && values.lienPolitique.trim()
        ? values.lienPolitique.trim()
        : "{{lien}}",
    );
}

// Dit honnêtement ce qui manque pour que les textes de consentement soient complets (utilisables tels quels).
export function consentTextsReady(values: ConsentValues): {
  ready: boolean;
  missing: Array<"raison_sociale" | "max" | "lien">;
} {
  const missing: Array<"raison_sociale" | "max" | "lien"> = [];
  if (!values.raisonSociale || !values.raisonSociale.trim()) missing.push("raison_sociale");
  if (values.maxParMois == null || values.maxParMois <= 0) missing.push("max");
  if (!values.lienPolitique || !values.lienPolitique.trim()) missing.push("lien");
  return { ready: missing.length === 0, missing };
}

// ————————————————————————————————————————————————————————————————
// Loi ÉVIN — garde anti-alcool sur tout texte de message sortant.
// ————————————————————————————————————————————————————————————————

// Termes qui font d'un message une publicité pour l'alcool (support non autorisé pour un club).
// Liste conservatrice et volontairement large : mieux vaut refuser un texte innocent que risquer 75 000 €.
// La promotion des bouteilles se fait SUR PLACE (menu/affichette), jamais par message.
const EVIN_BLOCKLIST = [
  "alcool",
  "champagne",
  "champ",
  "vodka",
  "whisky",
  "whiskey",
  "gin",
  "rhum",
  "rum",
  "tequila",
  "magnum",
  "bouteille",
  "bottle",
  "spiritueux",
  "cocktail",
  "biere",
  "beer",
  "vin",
  "wine",
  "liqueur",
  "shot",
  "shooter",
  "open bar",
  "openbar",
  "mojito",
  "ricard",
  "jager",
  "jagermeister",
  "moet",
  "hennessy",
  "belvedere",
  "ciroc",
  "grey goose",
  "dom perignon",
  "cuvee",
  "prosecco",
  "spritz",
  "tournee generale",
  "verre offert",
  "conso offerte",
] as const;

// Normalise pour comparaison : minuscules, accents retirés, ponctuation → espaces, espaces compactés.
function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // retire les diacritiques (e-accent -> e)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Vrai si `haystack` contient `needle` en respectant des frontières de mots (évite « vin » dans « avoine »).
function containsWordish(haystack: string, needle: string): boolean {
  const padded = ` ${haystack} `;
  return padded.includes(` ${needle} `);
}

// Refuse tout texte porteur d'un terme d'alcool. Retourne les termes détectés (pour un message d'UI clair).
export function checkMessageEvin(text: string): { ok: boolean; matched: string[] } {
  const normalized = normalizeForMatch(text);
  const matched = EVIN_BLOCKLIST.filter((term) => containsWordish(normalized, normalizeForMatch(term)));
  return { ok: matched.length === 0, matched };
}

// ————————————————————————————————————————————————————————————————
// Téléphone E.164 — clé de déduplication. Normalisation FR par défaut.
// ————————————————————————————————————————————————————————————————

// Normalise un numéro saisi en E.164 (+33…). Retourne null si non normalisable (aucun numéro inventé).
export function normalizeE164(raw: string, defaultCountry: "FR" = "FR"): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (!digits) return null;

  if (hasPlus) {
    // Déjà international : on garde tel quel s'il est plausible (7 à 15 chiffres, E.164).
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }
  if (defaultCountry === "FR") {
    // Format national FR : 0X XX XX XX XX (10 chiffres, préfixe 0) → +33 + 9 chiffres.
    if (digits.length === 10 && digits.startsWith("0")) return `+33${digits.slice(1)}`;
    // Déjà « 33… » sans le + : on préfixe.
    if (digits.length === 11 && digits.startsWith("33")) return `+${digits}`;
    // 9 chiffres sans le 0 initial (ex. « 612345678 ») → +33.
    if (digits.length === 9 && !digits.startsWith("0")) return `+33${digits}`;
  }
  return null;
}

export function isE164(value: string): boolean {
  return /^\+[1-9][0-9]{6,14}$/.test(value);
}

// ————————————————————————————————————————————————————————————————
// Scoring & segments (RFM, sans ML — 100 % déterministe et testable).
// ————————————————————————————————————————————————————————————————

// Segment PRIMAIRE d'un client (mutuellement exclusif). L'anniversaire est un FLAG additionnel
// (birthdayThisMonth), pas un segment exclusif : un VIP peut aussi être « anniversaire ce mois-ci ».
export const GUEST_SEGMENTS = [
  "vip",
  "regular",
  "one_shot",
  "dormant",
  "occasional",
  "prospect",
] as const;
export type GuestSegment = (typeof GUEST_SEGMENTS)[number];

export const GUEST_SEGMENT_LABELS: Record<GuestSegment, string> = {
  vip: "VIP",
  regular: "Régulier",
  one_shot: "One-shot (gros ticket)",
  dormant: "Dormant (à relancer)",
  occasional: "Occasionnel",
  prospect: "Prospect (jamais venu)",
};

// Seuils de la spec (rendus explicites et ajustables ici, pas cachés dans le SQL).
export const SEGMENT_RULES = {
  vipMinVisits180d: 3,
  vipMaxNoShowRate: 0.2,
  spendTopPercentile: 0.9, // top ~10 % de dépense
  minCohortForThreshold: 5, // en-dessous, aucun seuil top-10 % honnête → aucun VIP « par dépense »
  dormantMinDays: 45,
  oneShotMaxSeatedTotal: 1,
};

// Taux de no-show = no_shows / (seated + no_show). null si aucune visite résolue (dénominateur 0).
export function noShowRate(row: GuestScoreRow): number | null {
  if (row.visits_resolved_total <= 0) return null;
  return row.no_shows_total / row.visits_resolved_total;
}

// Jours écoulés depuis une date ISO (positifs = passé). null si date absente/illisible.
export function daysSince(isoDate: string | null, today: Date): number | null {
  if (!isoDate) return null;
  const then = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(then.getTime())) return null;
  const ref = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  return Math.floor((ref.getTime() - then.getTime()) / 86_400_000);
}

// Seuil de dépense « top 10 % » de la cohorte. null si trop peu de clients chiffrés (pas de seuil honnête).
// Percentile de type « nearest-rank » sur les dépenses > 0 des 12 derniers mois.
export function spendThreshold(rows: GuestScoreRow[]): number | null {
  const spends = rows
    .map((r) => r.spend_seated_12m)
    .filter((s): s is number => s != null && s > 0)
    .sort((a, b) => a - b);
  if (spends.length < SEGMENT_RULES.minCohortForThreshold) return null;
  const rank = Math.ceil(SEGMENT_RULES.spendTopPercentile * spends.length);
  return spends[Math.min(rank, spends.length) - 1];
}

export type SegmentInput = {
  today: Date;
  spendThreshold: number | null; // issu de spendThreshold(cohorte) ; null = pas de VIP « par dépense »
  birthdayMonth?: number | null; // 1-12, si connu (table guests) — pour le flag anniversaire
};

// Classe un client en segment primaire + flags actionnables. Déterministe, aucune donnée fabriquée.
export function classifyGuest(
  row: GuestScoreRow,
  input: SegmentInput,
): {
  segment: GuestSegment;
  daysSinceLastSeated: number | null;
  noShowRate: number | null;
  birthdayThisMonth: boolean;
  isTopSpender: boolean;
} {
  const days = daysSince(row.last_seated_date, input.today);
  const nsr = noShowRate(row);
  const isTopSpender =
    input.spendThreshold != null &&
    row.spend_seated_12m != null &&
    row.spend_seated_12m >= input.spendThreshold;
  const birthdayThisMonth =
    input.birthdayMonth != null && input.birthdayMonth === input.today.getUTCMonth() + 1;

  let segment: GuestSegment;
  if (row.visits_seated_total <= 0) {
    // Capté mais jamais assis (résa non honorée / à venir) → prospect, jamais présenté comme client fidèle.
    segment = "prospect";
  } else if (
    isTopSpender &&
    row.visits_seated_180d >= SEGMENT_RULES.vipMinVisits180d &&
    (nsr == null || nsr < SEGMENT_RULES.vipMaxNoShowRate)
  ) {
    segment = "vip";
  } else if (row.visits_seated_total === SEGMENT_RULES.oneShotMaxSeatedTotal && isTopSpender) {
    // Un seul passage mais gros ticket → relance rapide (fenêtre 7-10 j gérée par l'UI via daysSinceLastSeated).
    segment = "one_shot";
  } else if (days != null && days >= SEGMENT_RULES.dormantMinDays) {
    segment = "dormant";
  } else if (row.visits_seated_180d >= 2) {
    segment = "regular";
  } else {
    segment = "occasional";
  }

  return {
    segment,
    daysSinceLastSeated: days,
    noShowRate: nsr,
    birthdayThisMonth,
    isTopSpender,
  };
}

// ————————————————————————————————————————————————————————————————
// Préparation d'un contact wa.me — l'humain clique, l'outil ne fait que PRÉPARER.
// ————————————————————————————————————————————————————————————————

export type ContactGuardInput = {
  phoneE164: string | null;
  optOut: boolean; // opt_out_at renseigné (STOP)
  consentMarketing: boolean; // opt-in prospection (requis pour un message marketing)
  purpose: "marketing" | "service"; // service (contractuel) ne requiert pas le consent marketing
};

export type ContactPrep =
  | { ok: true; url: string }
  | { ok: false; reason: "no_phone" | "opt_out" | "no_consent" | "evin" | "empty_message" };

// Construit un lien wa.me/<tel>?text=<msg> APRÈS avoir passé toutes les gardes. Aucun envoi : c'est
// juste une URL que le promoteur ouvre depuis SON téléphone. Refuse (raison explicite) si :
//   · pas de numéro E.164 ; · client opt-out ; · message marketing sans consentement ;
//   · texte porteur d'alcool (Évin) ; · message vide.
export function prepareContactLink(guard: ContactGuardInput, message: string): ContactPrep {
  const text = message.trim();
  if (!text) return { ok: false, reason: "empty_message" };
  if (!guard.phoneE164 || !isE164(guard.phoneE164)) return { ok: false, reason: "no_phone" };
  if (guard.optOut) return { ok: false, reason: "opt_out" };
  if (guard.purpose === "marketing" && !guard.consentMarketing)
    return { ok: false, reason: "no_consent" };
  if (!checkMessageEvin(text).ok) return { ok: false, reason: "evin" };

  const tel = guard.phoneE164.replace(/[^0-9]/g, ""); // wa.me veut les chiffres sans « + »
  const url = `https://wa.me/${tel}?text=${encodeURIComponent(text)}`;
  return { ok: true, url };
}

// ————————————————————————————————————————————————————————————————
// Purge RGPD (calcul, pas destruction) & état vide honnête.
// ————————————————————————————————————————————————————————————————

// Un client est PURGEABLE si son dernier contact ENTRANT remonte à > 3 ans (référentiel CNIL gestion
// commerciale). Retourne un booléen calculé — la SUPPRESSION reste une décision explicite (jamais auto ici).
export function isPurgeable(lastInboundContactAt: string | null, today: Date): boolean {
  if (!lastInboundContactAt) return false; // sans repère de contact entrant, on ne purge pas à l'aveugle
  const last = new Date(lastInboundContactAt);
  if (Number.isNaN(last.getTime())) return false;
  const threeYearsMs = 3 * 365 * 86_400_000;
  return today.getTime() - last.getTime() > threeYearsMs;
}

// Reflet exact de ce qui est en base : combien de clients, combien consentent au marketing (hors opt-out),
// combien ont une dépense identifiée. Sert à afficher un état vide HONNÊTE (« base vide »).
export function crmDataReady(rows: GuestScoreRow[]): {
  total: number;
  withSpend: number;
  seatedAtLeastOnce: number;
} {
  return {
    total: rows.length,
    withSpend: rows.filter((r) => r.spend_seated_12m != null && r.spend_seated_12m > 0).length,
    seatedAtLeastOnce: rows.filter((r) => r.visits_seated_total > 0).length,
  };
}
