// lib/promoCodes.ts — logique PURE des codes promo (F4). 100% testable, aucune I/O.
// Validation (actif / fenêtre de validité / plafond global / plafond par guest) et calcul de remise.
// La remise ne rend jamais un sous-total négatif (borne à 0) ; le pourcentage est borné à [0,100].

export const DISCOUNT_TYPES = ["percent", "amount"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

// Miroir applicatif de public.promo_codes (0056).
export type PromoCode = {
  id: string;
  code: string;
  campaign_id?: string | null;
  discount_type: DiscountType;
  discount_value_cents: number; // percent : la valeur est un pourcentage (0..100) ; amount : centimes de remise
  max_redemptions?: number | null; // null = illimité
  redeemed_count?: number | null;
  per_guest_limit?: number | null; // défaut 1
  valid_from?: string | null; // ISO/date
  valid_until?: string | null; // ISO/date (inclus jusqu'à la fin de journée si date seule)
  active?: boolean | null;
};

export type ValidateContext = {
  now?: number | string | Date; // horloge injectable (déterminisme)
  guestRedemptions?: number; // rédemptions déjà faites par CE guest pour CE code
};

export type ValidateReason =
  | "ok"
  | "inactive"
  | "not_yet_valid"
  | "expired"
  | "max_redemptions_reached"
  | "per_guest_limit_reached";

export type ValidateResult = { valid: boolean; reason: ValidateReason };

function toMs(now: ValidateContext["now"]): number {
  if (now == null) return Date.now();
  if (typeof now === "number") return now;
  if (now instanceof Date) return now.getTime();
  const p = Date.parse(now);
  return Number.isNaN(p) ? Date.now() : p;
}

// Une date seule (YYYY-MM-DD) pour valid_until couvre toute la journée : on borne à la fin de journée UTC.
function endOfDayIfDateOnly(value: string): number {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  const base = Date.parse(value);
  if (Number.isNaN(base)) return NaN;
  return isDateOnly ? base + (24 * 60 * 60 * 1000 - 1) : base;
}

export function validatePromoCode(
  code: PromoCode | null | undefined,
  ctx: ValidateContext = {},
): ValidateResult {
  if (!code) return { valid: false, reason: "inactive" };

  // Actif ?
  if (code.active === false) return { valid: false, reason: "inactive" };

  const nowMs = toMs(ctx.now);

  // Fenêtre de validité.
  if (code.valid_from) {
    const from = Date.parse(code.valid_from);
    if (!Number.isNaN(from) && nowMs < from) {
      return { valid: false, reason: "not_yet_valid" };
    }
  }
  if (code.valid_until) {
    const until = endOfDayIfDateOnly(code.valid_until);
    if (!Number.isNaN(until) && nowMs > until) {
      return { valid: false, reason: "expired" };
    }
  }

  // Plafond global de rédemption.
  if (code.max_redemptions != null) {
    const used = code.redeemed_count ?? 0;
    if (used >= code.max_redemptions) {
      return { valid: false, reason: "max_redemptions_reached" };
    }
  }

  // Plafond par guest (défaut 1).
  const perGuest = code.per_guest_limit ?? 1;
  const already = ctx.guestRedemptions ?? 0;
  if (perGuest > 0 && already >= perGuest) {
    return { valid: false, reason: "per_guest_limit_reached" };
  }

  return { valid: true, reason: "ok" };
}

// Remise en centimes, bornée : jamais négative, jamais supérieure au sous-total.
// percent : discount_value_cents interprété comme pourcentage (0..100). amount : remise fixe en centimes.
export function computeDiscountCents(
  code: Pick<PromoCode, "discount_type" | "discount_value_cents">,
  subtotalCents: number,
): number {
  const subtotal = Number.isFinite(subtotalCents) && subtotalCents > 0 ? Math.floor(subtotalCents) : 0;
  if (subtotal === 0) return 0;

  const raw = Number(code.discount_value_cents) || 0;
  if (raw <= 0) return 0;

  if (code.discount_type === "percent") {
    const pct = Math.min(100, Math.max(0, raw));
    return Math.min(subtotal, Math.round((subtotal * pct) / 100));
  }
  // amount
  return Math.min(subtotal, Math.floor(raw));
}
