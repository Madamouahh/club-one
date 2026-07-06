// tests/tasks.test.mts — logique pure du module Tâches (lib/tasks.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canManageTasks,
  canViewTasks,
  canTransition,
  validateTransition,
  isClosedStatus,
  priorityRank,
  sortByPriority,
  groupByAssignee,
  groupByStatus,
  countByStatus,
  isOverdue,
  overdueTasks,
  validateTaskDraft,
  UNASSIGNED_KEY,
  type Task,
} from "../lib/tasks.ts";

const tasks: Task[] = [
  { id: "1", title: "Extincteurs", assignee_username: "jeremy", due_date: "2026-07-05", status: "todo", priority: "high" },
  { id: "2", title: "Playlist", assignee_username: "jeremy", due_date: "2026-07-10", status: "doing", priority: "normal" },
  { id: "3", title: "Stock glace", assignee_username: null, due_date: "2026-07-01", status: "todo", priority: "low" },
  { id: "4", title: "Bilan", assignee_username: "lea", due_date: "2026-07-06", status: "done", priority: "high" }, // close → jamais en retard
  { id: "5", title: "Sans date", assignee_username: "lea", due_date: null, status: "todo", priority: "normal" },
];
const TODAY = "2026-07-07";

test("gardes de rôle : direction gère, salarié consulte, promoteur exclu", () => {
  assert.equal(canManageTasks("admin"), true);
  assert.equal(canManageTasks("manager"), true);
  assert.equal(canManageTasks("server"), false);
  assert.equal(canViewTasks("server"), true);
  assert.equal(canViewTasks("promoter"), false);
});

test("transitions : graphe autorisé, refus des sauts interdits", () => {
  assert.equal(canTransition("todo", "doing"), true);
  assert.equal(canTransition("todo", "done"), true);
  assert.equal(canTransition("todo", "cancelled"), true);
  assert.equal(canTransition("doing", "done"), true);
  assert.equal(canTransition("done", "doing"), true); // réouverture
  assert.equal(canTransition("cancelled", "todo"), true); // réactivation
  assert.equal(canTransition("done", "cancelled"), false); // interdit
  assert.equal(canTransition("cancelled", "done"), false); // interdit
  assert.equal(canTransition("todo", "todo"), true); // idempotent
});

test("validateTransition : messages + statuts inconnus", () => {
  assert.equal(validateTransition("todo", "doing").ok, true);
  assert.equal(validateTransition("done", "cancelled").ok, false);
  assert.equal(validateTransition("x", "doing").ok, false);
  assert.equal(validateTransition("todo", "y").ok, false);
});

test("isClosedStatus", () => {
  assert.equal(isClosedStatus("done"), true);
  assert.equal(isClosedStatus("cancelled"), true);
  assert.equal(isClosedStatus("todo"), false);
  assert.equal(isClosedStatus("doing"), false);
});

test("priorityRank : high < normal < low ; inconnu = normal", () => {
  assert.equal(priorityRank("high"), 0);
  assert.equal(priorityRank("normal"), 1);
  assert.equal(priorityRank("low"), 2);
  assert.equal(priorityRank("???"), 1);
});

test("sortByPriority : priorité puis échéance, sans date en fin, non mutant", () => {
  const src: Task[] = [
    { id: "a", title: "A", status: "todo", priority: "low", due_date: "2026-07-02" },
    { id: "b", title: "B", status: "todo", priority: "high", due_date: "2026-07-09" },
    { id: "c", title: "C", status: "todo", priority: "high", due_date: "2026-07-03" },
    { id: "d", title: "D", status: "todo", priority: "normal", due_date: null },
  ];
  const sorted = sortByPriority(src);
  assert.deepEqual(sorted.map((t) => t.id), ["c", "b", "d", "a"]);
  assert.equal(src[0].id, "a"); // source inchangée
});

test("groupByAssignee : clé username, non assignées regroupées", () => {
  const g = groupByAssignee(tasks);
  assert.equal(g["jeremy"].length, 2);
  assert.equal(g["lea"].length, 2);
  assert.equal(g[UNASSIGNED_KEY].length, 1);
  assert.equal(g[UNASSIGNED_KEY][0].id, "3");
});

test("groupByStatus : toujours 4 colonnes même vides", () => {
  const g = groupByStatus(tasks);
  assert.deepEqual(Object.keys(g).sort(), ["cancelled", "doing", "done", "todo"]);
  assert.equal(g.todo.length, 3);
  assert.equal(g.doing.length, 1);
  assert.equal(g.done.length, 1);
  assert.equal(g.cancelled.length, 0);
});

test("countByStatus", () => {
  const c = countByStatus(tasks);
  assert.equal(c.todo, 3);
  assert.equal(c.doing, 1);
  assert.equal(c.done, 1);
  assert.equal(c.cancelled, 0);
});

test("isOverdue : échéance passée + non close ; close jamais en retard ; sans date jamais", () => {
  assert.equal(isOverdue(tasks[0], TODAY), true); // 07-05 < 07-07, todo
  assert.equal(isOverdue(tasks[1], TODAY), false); // 07-10 futur
  assert.equal(isOverdue(tasks[2], TODAY), true); // 07-01 < 07-07, todo
  assert.equal(isOverdue(tasks[3], TODAY), false); // done, malgré 07-06
  assert.equal(isOverdue(tasks[4], TODAY), false); // pas d'échéance
});

test("overdueTasks : sous-ensemble filtré", () => {
  const od = overdueTasks(tasks, TODAY);
  assert.deepEqual(od.map((t) => t.id).sort(), ["1", "3"]);
});

test("validateTaskDraft : titre requis, longueur, statut/priorité/date", () => {
  assert.equal(validateTaskDraft({ title: "" }).ok, false);
  assert.equal(validateTaskDraft({ title: "   " }).ok, false);
  assert.equal(validateTaskDraft({ title: "x".repeat(201) }).ok, false);
  assert.equal(validateTaskDraft({ title: "OK", status: "bogus" }).ok, false);
  assert.equal(validateTaskDraft({ title: "OK", priority: "urgent" }).ok, false);
  assert.equal(validateTaskDraft({ title: "OK", due_date: "07/07/2026" }).ok, false);
  assert.equal(validateTaskDraft({ title: "OK", due_date: "2026-13-40" }).ok, false);
  assert.equal(validateTaskDraft({ title: "OK", due_date: "2026-07-07", priority: "high", status: "todo" }).ok, true);
  assert.equal(validateTaskDraft({ title: "OK" }).ok, true); // tout optionnel vide
});
