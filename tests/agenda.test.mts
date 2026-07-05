// tests/agenda.test.mts — agrégateur agenda pur (lib/agenda.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAgenda, groupAgendaByDate, agendaKindLabel, type AgendaItem } from "../lib/agenda.ts";

const items: AgendaItem[] = [
  { date: "2026-07-12", kind: "maintenance", label: "Contrôle son" },
  { date: "2026-07-10", kind: "soiree", label: "Soirée Eden" },
  { date: "2026-07-10", kind: "artiste", label: "DJ X" },
  { date: "", kind: "campagne", label: "Sans date" }, // ignoré (pas d'échéance inventée)
  { date: "2026-07-08", kind: "commercial", label: "Privatisation Dupont" },
];

test("buildAgenda : tri par date puis par type, items sans date ignorés", () => {
  const a = buildAgenda(items);
  assert.deepEqual(a.map((i) => `${i.date}:${i.kind}`), [
    "2026-07-08:commercial",
    "2026-07-10:soiree",
    "2026-07-10:artiste",
    "2026-07-12:maintenance",
  ]);
});

test("buildAgenda : bornage `from`", () => {
  const a = buildAgenda(items, "2026-07-10");
  assert.equal(a.length, 3);
  assert.ok(a.every((i) => i.date >= "2026-07-10"));
});

test("groupAgendaByDate : sections par date", () => {
  const g = groupAgendaByDate(items);
  assert.deepEqual(g.map((x) => x.date), ["2026-07-08", "2026-07-10", "2026-07-12"]);
  assert.equal(g.find((x) => x.date === "2026-07-10")!.items.length, 2);
});

test("agendaKindLabel", () => {
  assert.equal(agendaKindLabel("soiree"), "Soirée");
  assert.equal(agendaKindLabel("maintenance"), "Maintenance");
});
