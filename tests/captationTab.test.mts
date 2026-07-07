import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCaptureUpsert,
  buildShotInsert,
  mapShotCaptureRow,
  mapShotListItemRow,
  normalizeVenue,
  type ShotListDraft,
} from "../lib/captation.ts";

// Helpers PURS du container CaptationTab : mappage lignes Supabase → modèle, et construction des payloads
// d'écriture (INSERT plan / UPSERT capture) sous RLS 0029. Aucun réseau, aucune donnée inventée.

// ————————————————————————————————————————————————————————————————
// normalizeVenue : univers borné (eden/terminus/cercle), tout le reste → null (« toutes salles »).
// ————————————————————————————————————————————————————————————————
test("normalizeVenue borne l'univers et rabat l'inconnu sur null", () => {
  assert.equal(normalizeVenue("eden"), "eden");
  assert.equal(normalizeVenue("terminus"), "terminus");
  assert.equal(normalizeVenue("cercle"), "cercle");
  assert.equal(normalizeVenue(" eden "), "eden"); // trim
  assert.equal(normalizeVenue("toutes"), null);
  assert.equal(normalizeVenue(""), null);
  assert.equal(normalizeVenue(null), null);
  assert.equal(normalizeVenue(undefined), null);
  assert.equal(normalizeVenue(42), null);
});

// ————————————————————————————————————————————————————————————————
// mapShotListItemRow : miroir tolérant de shot_list_items.
// ————————————————————————————————————————————————————————————————
test("mapShotListItemRow mappe une ligne complète sans rien inventer", () => {
  const item = mapShotListItemRow({
    id: "sl-1",
    venue: "eden",
    label: "Arrivée tête d'affiche",
    sujet: "Artiste",
    format: "Reel",
    heure_ideale: "23h45",
    prioritaire: true,
    position: 2,
    active: true,
    auteur_username: "manager",
    created_at: "2026-07-07T20:00:00.000Z",
    updated_at: "2026-07-07T20:00:00.000Z",
  });
  assert.deepEqual(item, {
    id: "sl-1",
    venue: "eden",
    label: "Arrivée tête d'affiche",
    sujet: "Artiste",
    format: "Reel",
    heure_ideale: "23h45",
    prioritaire: true,
    position: 2,
    active: true,
    auteur_username: "manager",
    created_at: "2026-07-07T20:00:00.000Z",
    updated_at: "2026-07-07T20:00:00.000Z",
  });
});

test("mapShotListItemRow : champs libres absents → null, univers inconnu → null, defaults honnêtes", () => {
  const item = mapShotListItemRow({
    id: "sl-2",
    venue: "inconnu",
    label: "Plan sans détails",
    position: "not-a-number",
    auteur_username: "admin",
  });
  assert.equal(item.venue, null);
  assert.equal(item.sujet, null);
  assert.equal(item.format, null);
  assert.equal(item.heure_ideale, null);
  assert.equal(item.prioritaire, false);
  assert.equal(item.position, 0); // NaN → 0
  assert.equal(item.active, true); // colonne NOT NULL default true
});

test("mapShotListItemRow : active=false est respecté (plan désactivé)", () => {
  const item = mapShotListItemRow({ id: "sl-3", label: "Archivé", active: false });
  assert.equal(item.active, false);
});

// ————————————————————————————————————————————————————————————————
// mapShotCaptureRow : miroir tolérant de shot_captures.
// ————————————————————————————————————————————————————————————————
test("mapShotCaptureRow mappe une capture et borne le statut", () => {
  const cap = mapShotCaptureRow({
    id: "sc-1",
    item_id: "sl-1",
    event_id: "ev-1",
    exploitation_date: "2026-07-07",
    status: "depose",
    dam_ref: "DAM-001",
    note: "ok",
    updated_by: "manager",
    updated_at: "2026-07-07T21:00:00.000Z",
  });
  assert.deepEqual(cap, {
    id: "sc-1",
    item_id: "sl-1",
    event_id: "ev-1",
    exploitation_date: "2026-07-07",
    status: "depose",
    dam_ref: "DAM-001",
    note: "ok",
    updated_by: "manager",
    updated_at: "2026-07-07T21:00:00.000Z",
  });
});

test("mapShotCaptureRow : statut hors vocabulaire → a_capturer (jamais inventé), nulls honnêtes", () => {
  const cap = mapShotCaptureRow({
    id: "sc-2",
    item_id: "sl-2",
    exploitation_date: "2026-07-07",
    status: "n_importe_quoi",
  });
  assert.equal(cap.status, "a_capturer");
  assert.equal(cap.event_id, null);
  assert.equal(cap.dam_ref, null);
  assert.equal(cap.note, null);
});

// ————————————————————————————————————————————————————————————————
// buildShotInsert : payload d'INSERT (shot_list_items) à partir d'un brouillon validé.
// ————————————————————————————————————————————————————————————————
test("buildShotInsert nettoie les champs libres et fixe l'auteur (anti-usurpation)", () => {
  const draft: ShotListDraft = {
    label: "  Ambiance dancefloor  ",
    venue: "eden",
    sujet: "  Public  ",
    format: "",
    heure_ideale: "   ",
    prioritaire: true,
    position: 3,
  };
  const payload = buildShotInsert(draft, "manager");
  assert.deepEqual(payload, {
    venue: "eden",
    label: "Ambiance dancefloor", // trim
    sujet: "Public", // trim
    format: null, // vide → null
    heure_ideale: null, // blancs → null
    prioritaire: true,
    position: 3,
    auteur_username: "manager", // = utilisateur de session
  });
});

test("buildShotInsert : univers inconnu → null, defaults prioritaire/position", () => {
  const payload = buildShotInsert({ label: "Story", venue: "toutes" }, "admin");
  assert.equal(payload.venue, null);
  assert.equal(payload.prioritaire, false);
  assert.equal(payload.position, 0);
  assert.equal(payload.auteur_username, "admin");
});

// ————————————————————————————————————————————————————————————————
// buildCaptureUpsert : payload d'UPSERT (shot_captures) pour la soirée active.
// ————————————————————————————————————————————————————————————————
test("buildCaptureUpsert lie item + soirée active + auteur (contrainte unique item_id/date)", () => {
  const payload = buildCaptureUpsert(
    "sl-1",
    "capture",
    { eventId: "ev-42", eventDate: "2026-07-07" },
    "manager",
  );
  assert.deepEqual(payload, {
    item_id: "sl-1",
    event_id: "ev-42",
    exploitation_date: "2026-07-07",
    status: "capture",
    updated_by: "manager",
  });
});
