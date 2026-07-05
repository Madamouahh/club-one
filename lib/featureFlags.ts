// lib/featureFlags.ts — registre des feature flags du programme « gestion complète » (D-03).
//
// Objectif : construire et intégrer des modules EN CONTINU sans exposer d'écran non terminé (§10). Un
// module en cours ou bloqué reste derrière son flag (défaut OFF) → il n'apparaît pas en navigation tant
// qu'il n'est pas « terminé ». Les modules HISTORIQUES déjà exploités (plan, réservations, clients,
// sécurité, flux, promoteurs, stats, caisse, pnl, rh, monplanning, artistes, funnel, crm, incidents,
// apprentissage) ne sont PAS pilotés ici : ils sont toujours actifs via lib/permissions.ts (APP_TABS).
//
// Ce module ne pilote QUE les NOUVEAUX modules du programme (cockpits, maintenance, stock étendu,
// commercial, campagnes, agenda…). Fonction PURE d'une chaîne d'override → 100% testable, aucun accès
// réseau/DB. La chaîne vient de NEXT_PUBLIC_CLUB_FEATURES (build front) ; défauts sûrs sinon.

export const FEATURE_KEYS = [
  // NB graduation : « cockpitManager » et « maintenance » sont TERMINÉS (§10) → onglets permanents
  // (permissions.ts APP_TABS), retirés de ce registre. Un module quitte le registre quand il est fini.
  "cockpitDirection", // cockpit décisionnel direction (agrégat global)
  "opsChecklists", // checklists ouverture/fermeture (0028) câblées
  "opsCaptation", // captation/DAM (0029) câblée
  "internalComms", // communication interne (0026) câblée
  "auditJournal", // journal d'audit (0033) en lecture direction
  "commercial", // leads / privatisations / devis
  "campaigns", // marketing : campagnes / canaux / ROAS
  "agenda", // agenda global + invitations + file d'envoi
  "stockInventory", // inventaires / mouvements / pertes / fournisseurs / commandes
  // NB : « maintenance » a GRADUÉ (module terminé §10) → onglet direction permanent (permissions.ts
  //      APP_TABS), plus piloté par flag. Un module quitte ce registre quand il est terminé.
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

// Défaut de CHAQUE nouveau module : OFF tant qu'il n'est pas « terminé » (§10). On passe un flag à
// `true` ici uniquement quand le module est réellement câblé + relié base + role-gated + testé + mobile.
export const FEATURE_DEFAULTS: Record<FeatureKey, boolean> = {
  cockpitDirection: false,
  opsChecklists: false,
  opsCaptation: false,
  internalComms: false,
  auditJournal: false,
  commercial: false,
  campaigns: false,
  agenda: false,
  stockInventory: false,
};

// Parse la chaîne d'override : liste séparée par des virgules. `key` = force ON ; `!key` = force OFF.
// Les clés inconnues sont ignorées (robustesse : une clé retirée du code ne casse pas le build).
export function parseFeatureOverrides(raw?: string | null): Partial<Record<FeatureKey, boolean>> {
  const out: Partial<Record<FeatureKey, boolean>> = {};
  if (!raw) return out;
  const known = new Set<string>(FEATURE_KEYS);
  for (const token of raw.split(",")) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const off = trimmed.startsWith("!");
    const key = off ? trimmed.slice(1).trim() : trimmed;
    if (known.has(key)) {
      out[key as FeatureKey] = !off;
    }
  }
  return out;
}

// Résout l'état effectif d'un flag : override explicite sinon défaut.
export function isFeatureEnabled(key: FeatureKey, raw?: string | null): boolean {
  const overrides = parseFeatureOverrides(raw);
  return key in overrides ? Boolean(overrides[key]) : FEATURE_DEFAULTS[key];
}

// Liste des flags effectivement actifs (pour la navigation / debug).
export function enabledFeatures(raw?: string | null): FeatureKey[] {
  return FEATURE_KEYS.filter((key) => isFeatureEnabled(key, raw));
}

// Statut d'affichage honnête d'un adaptateur externe (D-02) : jamais un mock présenté comme réel.
export type AdapterStatus = "PRÊT À CONNECTER" | "NON ACTIVÉ" | "ACTIF";

// Un adaptateur externe (SMS/email/WhatsApp/caisse/paiement) est ACTIF seulement si sa clé est présente
// ET son flag activé ; sinon on affiche un statut honnête. On ne lit PAS la valeur de la clé, juste sa présence.
export function adapterStatus(hasKey: boolean, featureOn: boolean): AdapterStatus {
  if (hasKey && featureOn) return "ACTIF";
  if (featureOn) return "PRÊT À CONNECTER";
  return "NON ACTIVÉ";
}
