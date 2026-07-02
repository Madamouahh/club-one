import assert from "node:assert/strict";
import test from "node:test";

import {
  CALL_LIST_RULES,
  CALL_REASONS,
  CALL_REASON_META,
  assignCallReason,
  buildCallList,
  callReasonWhy,
  daysUntilBirthday,
  suggestCallMessage,
  tallyCallReasons,
  type CallListGuest,
} from "../lib/crmCallList.ts";
import { checkMessageEvin } from "../lib/crmClients.ts";

const TODAY = new Date(Date.UTC(2026, 6, 7)); // 2026-07-07 (référence déterministe)

function guest(over: Partial<CallListGuest> = {}): CallListGuest {
  return {
    guest_id: over.guest_id ?? "g1",
    first_name: over.first_name ?? "Alex",
    last_name: over.last_name ?? null,
    owner_promoter: over.owner_promoter ?? "promo1",
    phone: over.phone ?? "+33612345678",
    consent_marketing: over.consent_marketing ?? true,
    opt_out: over.opt_out ?? false,
    birthday: over.birthday ?? null,
    segment: over.segment ?? "occasional",
    days_since_last_seated: over.days_since_last_seated ?? null,
    spend_seated_12m: over.spend_seated_12m ?? null,
    no_show_rate: over.no_show_rate ?? null,
    upcoming_resa_date: over.upcoming_resa_date ?? null,
  };
}

test("base vide → call-list vide, aucun client inventé", () => {
  const res = buildCallList([], TODAY);
  assert.deepEqual(res.entries, []);
  assert.equal(res.eligibleCount, 0);
  assert.equal(res.dormantDropped, 0);
  assert.equal(res.totalDropped, 0);
});

test("historique importé (OctoTable) → JAMAIS auto-ciblé par la call-list (relance = GO fondateur)", () => {
  // Un historique importé sans visite datée : pas de résa à venir, pas d'anniversaire connu (DOB absente
  // à l'import), pas VIP/one_shot/dormant (0 visite datée). assignCallReason DOIT renvoyer null → il
  // n'entre pas dans le rituel du mardi. La relance de ces clients passe par une validation fondateur.
  const g = guest({ segment: "historique", birthday: null, days_since_last_seated: null });
  assert.equal(assignCallReason(g, TODAY), null);
  const res = buildCallList([g], TODAY);
  assert.equal(res.entries.length, 0);
  assert.equal(res.eligibleCount, 0);
});

test("une résa à venir prime tout : confirm_j1 (service, pas de consentement marketing requis)", () => {
  // Un VIP AVEC une résa à venir → on confirme d'abord (anti no-show), pas une invitation marketing.
  const g = guest({ segment: "vip", spend_seated_12m: 5000, upcoming_resa_date: "2026-07-08" });
  assert.equal(assignCallReason(g, TODAY), "confirm_j1");
  const res = buildCallList([g], TODAY);
  assert.equal(res.entries.length, 1);
  assert.equal(res.entries[0].reason, "confirm_j1");
  assert.equal(res.entries[0].waPurpose, "service");
  assert.equal(res.entries[0].contactPurpose, "confirmation");
  assert.match(res.entries[0].why, /J-1/);
});

test("VIP sans résa → vip_no_resa (marketing/invitation)", () => {
  const g = guest({ segment: "vip", spend_seated_12m: 3000 });
  assert.equal(assignCallReason(g, TODAY), "vip_no_resa");
  const e = buildCallList([g], TODAY).entries[0];
  assert.equal(e.waPurpose, "marketing");
  assert.equal(e.contactPurpose, "invitation");
});

test("one-shot inclus seulement dans la fenêtre 7-10 j", () => {
  const inWindow = guest({ guest_id: "os1", segment: "one_shot", days_since_last_seated: 8, spend_seated_12m: 900 });
  const stale = guest({ guest_id: "os2", segment: "one_shot", days_since_last_seated: 30, spend_seated_12m: 900 });
  assert.equal(assignCallReason(inWindow, TODAY), "one_shot");
  // Hors fenêtre, sans anniversaire proche → écarté de la call-list (pas de motif).
  assert.equal(assignCallReason(stale, TODAY), null);
});

test("anniversaire à J-14 inclus, cross-segment ; au-delà exclu si aucun autre motif", () => {
  const soon = guest({ guest_id: "b1", segment: "occasional", birthday: "1990-07-15" }); // dans 8 j
  const far = guest({ guest_id: "b2", segment: "occasional", birthday: "1990-09-01" }); // >14 j
  assert.equal(assignCallReason(soon, TODAY), "birthday");
  assert.equal(assignCallReason(far, TODAY), null);
});

test("dormant plafonné à dormantMax, écart signalé (jamais de troncature silencieuse)", () => {
  const dormants = Array.from({ length: 8 }, (_, i) =>
    guest({ guest_id: `d${i}`, first_name: `D${i}`, segment: "dormant", days_since_last_seated: 50 + i }),
  );
  const res = buildCallList(dormants, TODAY);
  assert.equal(res.entries.length, CALL_LIST_RULES.dormantMax);
  assert.equal(res.dormantDropped, 8 - CALL_LIST_RULES.dormantMax);
  // Les dormants gardés sont les plus « frais » (days_since croissant).
  const days = res.entries.map((e) => e.guest.days_since_last_seated);
  assert.deepEqual(days, [50, 51, 52, 53, 54]);
});

test("plafond total totalMax appliqué, totalDropped exposé", () => {
  // 30 VIP sans résa → 30 éligibles, tronqués à totalMax.
  const vips = Array.from({ length: 30 }, (_, i) =>
    guest({ guest_id: `v${i}`, first_name: `V${i}`, segment: "vip", spend_seated_12m: 1000 + i }),
  );
  const res = buildCallList(vips, TODAY);
  assert.equal(res.eligibleCount, 30);
  assert.equal(res.entries.length, CALL_LIST_RULES.totalMax);
  assert.equal(res.totalDropped, 30 - CALL_LIST_RULES.totalMax);
});

test("priorité entre motifs : confirm_j1 < vip < one_shot < birthday < dormant", () => {
  const mixed = [
    guest({ guest_id: "dor", segment: "dormant", days_since_last_seated: 60 }),
    guest({ guest_id: "bd", segment: "occasional", birthday: "1990-07-10" }),
    guest({ guest_id: "os", segment: "one_shot", days_since_last_seated: 5, spend_seated_12m: 900 }),
    guest({ guest_id: "vip", segment: "vip", spend_seated_12m: 4000 }),
    guest({ guest_id: "conf", segment: "regular", upcoming_resa_date: "2026-07-08" }),
  ];
  const order = buildCallList(mixed, TODAY).entries.map((e) => e.guest.guest_id);
  assert.deepEqual(order, ["conf", "vip", "os", "bd", "dor"]);
});

test("tri secondaire vip par dépense décroissante", () => {
  const vips = [
    guest({ guest_id: "low", segment: "vip", spend_seated_12m: 1000 }),
    guest({ guest_id: "high", segment: "vip", spend_seated_12m: 9000 }),
    guest({ guest_id: "mid", segment: "vip", spend_seated_12m: 5000 }),
  ];
  const order = buildCallList(vips, TODAY).entries.map((e) => e.guest.guest_id);
  assert.deepEqual(order, ["high", "mid", "low"]);
});

test("tri secondaire confirm_j1 par date de résa la plus proche", () => {
  const rows = [
    guest({ guest_id: "late", segment: "regular", upcoming_resa_date: "2026-07-20" }),
    guest({ guest_id: "soon", segment: "regular", upcoming_resa_date: "2026-07-08" }),
  ];
  const order = buildCallList(rows, TODAY).entries.map((e) => e.guest.guest_id);
  assert.deepEqual(order, ["soon", "late"]);
});

test("daysUntilBirthday : aujourd'hui=0, demain=1, passé→année suivante, illisible→null", () => {
  assert.equal(daysUntilBirthday("1990-07-07", TODAY), 0);
  assert.equal(daysUntilBirthday("1990-07-08", TODAY), 1);
  assert.equal(daysUntilBirthday("1990-07-06", TODAY), 364); // anniversaire d'hier → 2027-07-06
  assert.equal(daysUntilBirthday(null, TODAY), null);
  assert.equal(daysUntilBirthday("pas-une-date", TODAY), null);
});

test("les gabarits de message suggérés passent la garde Évin et personnalisent par prénom", () => {
  for (const reason of CALL_REASONS) {
    const msg = suggestCallMessage(reason, "Camille", "2026-07-12");
    assert.ok(checkMessageEvin(msg).ok, `Évin: ${reason} → ${msg}`);
    assert.match(msg, /Camille/);
  }
  // Prénom vide → repli neutre, toujours sans alcool.
  const fallback = suggestCallMessage("dormant", "   ");
  assert.ok(checkMessageEvin(fallback).ok);
});

test("contactPurpose ∈ enum CHECK guest_contacts.purpose (0013), aucune dérive", () => {
  const allowed = new Set([
    "invitation",
    "confirmation",
    "relance_dormant",
    "anniversaire",
    "one_shot",
    "autre",
  ]);
  for (const reason of CALL_REASONS) {
    assert.ok(allowed.has(CALL_REASON_META[reason].contactPurpose), reason);
  }
});

test("tallyCallReasons compte par motif", () => {
  const rows = [
    guest({ guest_id: "v1", segment: "vip", spend_seated_12m: 2000 }),
    guest({ guest_id: "v2", segment: "vip", spend_seated_12m: 2500 }),
    guest({ guest_id: "c1", segment: "regular", upcoming_resa_date: "2026-07-09" }),
  ];
  const tally = tallyCallReasons(buildCallList(rows, TODAY).entries);
  assert.equal(tally.vip_no_resa, 2);
  assert.equal(tally.confirm_j1, 1);
  assert.equal(tally.dormant, 0);
});

test("callReasonWhy reste honnête (chiffres réels, aucune promesse fabriquée)", () => {
  const g = guest({ segment: "dormant", days_since_last_seated: 52 });
  assert.match(callReasonWhy(g, "dormant", TODAY), /52 j/);
  const gNoData = guest({ segment: "dormant", days_since_last_seated: null });
  assert.doesNotMatch(callReasonWhy(gNoData, "dormant", TODAY), /\d+ j/);
});
