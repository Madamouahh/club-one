// lib/crmScan.ts — logique PURE du SCAN À LA PORTE du QR d'entrée (V0, spec MODULE_CRM_CLIENTS_VIP.md §V0).
// Aucun accès réseau. MIROIR côté client de la RPC scan_guest_pass_v1 (migration 0015) : extraire le
// jeton d'un QR scanné, puis interpréter la réponse serveur en un feedback d'écran honnête pour le
// portier. Le vrai enforcement (rôle, soirée active, idempotence, présence seated) est en SQL — ces
// fonctions ne font que présenter, jamais une sécurité.
//
// Règle dure : on ne fabrique aucune présence ni aucun message rassurant. Un code inconnu du serveur
// est présenté comme un refus explicite, pas comme un succès.

// ————————————————————————————————————————————————————————————————
// Rôles autorisés à scanner à la porte (miroir de la garde SQL de 0015 et de canCheckInQr).
// La sécurité réelle est la RPC SECURITY DEFINER ; cette constante ne sert qu'à cacher l'UI.
// ————————————————————————————————————————————————————————————————
export const DOOR_SCAN_ROLES = ["admin", "manager", "security", "security_counter"] as const;

// ————————————————————————————————————————————————————————————————
// Extraction du jeton d'entrée depuis la valeur brute d'un QR scanné.
// ————————————————————————————————————————————————————————————————
// Le QR d'entrée (page publique /i/[token], session 10) encode le JETON BRUT opaque généré côté
// serveur : deux uuid hex concaténés → 64 caractères hexadécimaux. On refuse tout ce qui n'a pas
// cette forme, en particulier une URL (ex. le QR d'INVITATION d'un promoteur encode « …/i/<token> »,
// ce n'est PAS un pass d'entrée). Refuser ici évite d'envoyer un mauvais jeton à la RPC.
const PASS_TOKEN_RE = /^[0-9a-f]{32,128}$/;

export function extractPassToken(scanned: string | null | undefined): string | null {
  const raw = (scanned ?? "").trim();
  if (!raw) return null;
  // Une URL (QR d'invitation, lien collé) n'est jamais un jeton d'entrée : rejet explicite.
  if (/[/:?#]/.test(raw)) return null;
  const lower = raw.toLowerCase();
  if (!PASS_TOKEN_RE.test(lower)) return null;
  return lower;
}

// ————————————————————————————————————————————————————————————————
// Interprétation de la réponse de scan_guest_pass_v1 en feedback d'écran.
// ————————————————————————————————————————————————————————————————
export type ScanPassResult = {
  ok: boolean;
  code: string;
  message: string;
  first_name: string | null;
  univers: string | null;
  is_host: boolean | null;
  scanned_at: string | null;
  scanned_by: string | null;
};

export type ScanTone = "ok" | "warn" | "error";

export type ScanFeedback = {
  tone: ScanTone; // ok = entrée validée · warn = déjà entré/refus doux · error = refus dur
  title: string;
  detail: string;
  admitted: boolean; // le client peut-il entrer ? (true pour ok ET already_scanned)
};

// Libellé de salle lisible (aligné sur guest_visits.univers). Inconnu → tel quel (jamais inventé).
function universLabel(univers: string | null): string {
  switch (univers) {
    case "eden":
      return "EDEN";
    case "cercle":
      return "CERCLE";
    case "terminus":
      return "TERMINUS";
    default:
      return univers ?? "";
  }
}

// Traduit un code serveur en feedback. Tout code non listé retombe sur un refus honnête (jamais un
// faux succès) : la source de vérité reste `ok` renvoyé par la RPC.
export function interpretScanResult(result: ScanPassResult): ScanFeedback {
  const name = result.first_name?.trim() || "Invité";
  const salle = universLabel(result.univers);
  const hostTag = result.is_host ? " · HÔTE de table" : "";

  switch (result.code) {
    case "ok":
      return {
        tone: "ok",
        admitted: true,
        title: `✓ ${name} — entrée validée`,
        detail: [salle, "présence enregistrée", hostTag.trim()].filter(Boolean).join(" · "),
      };
    case "already_scanned":
      return {
        tone: "warn",
        admitted: true,
        title: `${name} — déjà entré`,
        detail: [salle, "présence déjà enregistrée", hostTag.trim()].filter(Boolean).join(" · "),
      };
    case "invalid_token":
      return { tone: "error", admitted: false, title: "QR illisible", detail: "Le QR est vide ou invalide." };
    case "unknown_pass":
      return { tone: "error", admitted: false, title: "QR inconnu", detail: "Aucune inscription ne correspond à ce QR." };
    case "wrong_event":
      return {
        tone: "error",
        admitted: false,
        title: `${name} — mauvaise soirée`,
        detail: "Ce QR est valide mais pas pour la soirée en cours.",
      };
    case "pass_cancelled":
      return { tone: "error", admitted: false, title: `${name} — QR annulé`, detail: "Ce QR a été annulé." };
    case "missing_active_event":
      return { tone: "error", admitted: false, title: "Aucune soirée active", detail: "Active une soirée avant de scanner." };
    case "unauthorized":
      return { tone: "error", admitted: false, title: "Action non autorisée", detail: "Ton rôle ne permet pas le scan à la porte." };
    default:
      // Code inattendu : on ne fabrique pas un succès. On présente le message serveur tel quel.
      return {
        tone: result.ok ? "warn" : "error",
        admitted: result.ok,
        title: result.ok ? name : "Refusé",
        detail: result.message?.trim() || "Réponse inattendue du serveur.",
      };
  }
}

// ————————————————————————————————————————————————————————————————
// Pré-vérification PURE côté client, AVANT tout appel réseau.
// ————————————————————————————————————————————————————————————————
// Extrait le jeton d'un QR scanné et, s'il est illisible (URL d'invitation collée, vide, forme non
// hexadécimale), renvoie DIRECTEMENT le feedback de refus 'invalid_token' — sans envoyer un mauvais
// jeton à la RPC. Sinon renvoie le jeton propre à transmettre à scan_guest_pass_v1. La sécurité réelle
// reste en SQL : ce garde ne fait qu'éviter un aller-retour réseau inutile et présenter un refus honnête.
export type ScanPrecheck =
  | { ok: true; token: string }
  | { ok: false; feedback: ScanFeedback };

export function precheckScannedPass(scanned: string | null | undefined): ScanPrecheck {
  const token = extractPassToken(scanned);
  if (!token) {
    return {
      ok: false,
      feedback: interpretScanResult({
        ok: false,
        code: "invalid_token",
        message: "",
        first_name: null,
        univers: null,
        is_host: null,
        scanned_at: null,
        scanned_by: null,
      }),
    };
  }
  return { ok: true, token };
}

// Normalise la réponse Supabase (data en tableau OU objet, ou erreur réseau) en un ScanPassResult.
// Aucune donnée fabriquée : une erreur réseau devient un code 'network_error' explicite.
export function normalizeScanResponse(input: {
  data: ScanPassResult[] | ScanPassResult | null;
  error: { message: string } | null;
}): ScanPassResult {
  if (input.error) {
    return {
      ok: false,
      code: "network_error",
      message: input.error.message || "Erreur réseau pendant le scan.",
      first_name: null,
      univers: null,
      is_host: null,
      scanned_at: null,
      scanned_by: null,
    };
  }
  const row = Array.isArray(input.data) ? input.data[0] : input.data;
  if (!row) {
    return {
      ok: false,
      code: "network_error",
      message: "Réponse vide du serveur.",
      first_name: null,
      univers: null,
      is_host: null,
      scanned_at: null,
      scanned_by: null,
    };
  }
  return {
    ok: !!row.ok,
    code: row.code,
    message: row.message,
    first_name: row.first_name ?? null,
    univers: row.univers ?? null,
    is_host: row.is_host ?? null,
    scanned_at: row.scanned_at ?? null,
    scanned_by: row.scanned_by ?? null,
  };
}
