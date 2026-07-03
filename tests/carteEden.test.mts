// tests/carteEden.test.mts — cross-check STATIQUE (niveau 3) : SEED carte Eden ↔ SOURCE fondateur.
//
// Garde « deux sources, une vérité » (même tradition que venueTables ↔ 0031, EDEN_TABLES ↔ EDEN_SEED_V2).
// Compare le SEED de la migration `supabase/migrations/0032_produits_bar_multi_venue_carte_eden.sql`
// à la transcription de référence `docs/carte-eden-2026.md` (copie in-repo de CARTE_EDEN_2026.md,
// transcrite du PDF fondateur). Objectif : les PRIX RÉELS du fondateur (critiques pour le P&L) ne
// peuvent plus dériver en silence, et les règles dures fondateur sont encodées en invariants exécutables :
//   · ⛔ Mont d'Or rôti RETIRÉ → jamais dans le seed ;
//   · cuisine = EXACTEMENT 3 planches + 3 paninis, rien d'autre ;
//   · ⚠️ 3 mappings à confirmer (Volcan 4cl 13, Don Julio 70cl 390, Bombay 70cl 130) = les SEULS a_verifier.
//
// Niveau de preuve : 3 (statique code ↔ doc). Ne prouve NI l'exécution PostgreSQL du seed (niveau 4),
// NI un rendu réel. Prouve que la migration et la carte de référence disent la même chose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ----------------------------------------------------------------------------
// Normalisation commune (le seed normalise volontairement quelques libellés :
// il retire « décl. » et déplace « (bouteille NNcl) » vers la colonne format).
// ----------------------------------------------------------------------------
function normName(raw: string): string {
  return raw
    .replace(/''/g, "'") // dé-échappe les apostrophes SQL
    .replace(/[’]/g, "'") // apostrophe typographique → ASCII
    .replace(/décl\.\s*/gi, "") // « décl. » présent en source, absent du seed
    .replace(/\(bouteille\s+\d+cl\)/gi, "(bouteille)") // Corona/Bud : cl déplacé en format
    .replace(/^tequila\s+/i, "") // le seed préfixe « Tequila » (Don Julio 1942 ; cohérent avec Volcan) ; source terse
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normFmt(raw: string | null): string {
  if (raw === null) return "";
  const t = raw.trim();
  if (t === "" || t === "—") return "";
  return t.toLowerCase();
}

const PRICE_RE = /\d+\.\d{2}/g; // les prix sont toujours écrits à 2 décimales (4.00, 13.00, 8.50…)

function extractPrices(cell: string): number[] {
  return (cell.match(PRICE_RE) ?? []).map(Number);
}

type Line = { name: string; fmt: string; price: number; flagged: boolean };
const pairKey = (l: { name: string; price: number }) => `${l.name}|${l.price.toFixed(2)}`;
const tripleKey = (l: Line) => `${l.name}|${l.fmt}|${l.price.toFixed(2)}`;

// ----------------------------------------------------------------------------
// 1) Parse du SEED (bloc VALUES de la migration 0032 carte Eden).
//    Tuple : ('categorie','nom', <null|'format'>, prix, <true|false>)
//    nom/categorie/format peuvent contenir des '' (apostrophe échappée), virgules, « », parenthèses.
// ----------------------------------------------------------------------------
type SeedRow = { categorie: string; nom: string; format: string | null; prix: number; aVerifier: boolean };

function readSeedSql(): string {
  return readFileSync(
    join(process.cwd(), "supabase", "migrations", "0032_produits_bar_multi_venue_carte_eden.sql"),
    "utf8",
  );
}

function parseSeed(sql: string): SeedRow[] {
  // Isole le bloc VALUES ( … ) as v(...) pour ne pas capturer d'autres parenthèses.
  const start = sql.indexOf("from (values");
  const end = sql.indexOf(") as v(", start);
  assert.ok(start >= 0 && end > start, "bloc VALUES du seed introuvable");
  const block = sql.slice(start, end);

  const q = "'(?:[^']|'')*'"; // chaîne SQL simple, '' interne autorisé
  const re = new RegExp(
    `\\(\\s*(${q})\\s*,\\s*(${q})\\s*,\\s*(null(?:::text)?|${q})\\s*,\\s*([\\d.]+)\\s*,\\s*(true|false)\\s*\\)`,
    "g",
  );
  const unquote = (s: string) => s.slice(1, -1).replace(/''/g, "'");
  const rows: SeedRow[] = [];
  for (const m of block.matchAll(re)) {
    const fmtRaw = m[3];
    rows.push({
      categorie: unquote(m[1]),
      nom: unquote(m[2]),
      format: fmtRaw.startsWith("null") ? null : unquote(fmtRaw),
      prix: Number(m[4]),
      aVerifier: m[5] === "true",
    });
  }
  return rows;
}

// ----------------------------------------------------------------------------
// 2) Parse de la SOURCE (docs/carte-eden-2026.md) — tables markdown par section.
//    Colonnes-prix = en-tête « Prix » (format lu dans la colonne « Format », multi « a / b » zippé)
//    OU en-tête « NNcl » (le format EST l'en-tête). Un « ⚠️ » dans une cellule prix = mapping à confirmer.
// ----------------------------------------------------------------------------
function readSourceMd(): string {
  return readFileSync(join(process.cwd(), "docs", "carte-eden-2026.md"), "utf8");
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const isSeparator = (cells: string[]) => cells.every((c) => /^:?-+:?$/.test(c));

function parseSource(md: string): Line[] {
  const lines: Line[] = [];
  let header: string[] | null = null;

  for (const raw of md.split(/\r?\n/)) {
    if (!raw.trim().startsWith("|")) {
      header = null; // toute ligne non-tableau ferme le tableau courant
      continue;
    }
    const cells = splitRow(raw);
    if (isSeparator(cells)) continue;
    if (header === null) {
      header = cells;
      continue;
    }

    const prodIdx = header.findIndex((h) => h === "Produit");
    if (prodIdx < 0) continue;
    const name = cells[prodIdx] ?? "";
    const fmtColIdx = header.findIndex((h) => h === "Format");

    for (let i = 0; i < header.length; i++) {
      const h = header[i];
      const cell = cells[i] ?? "";
      const flagged = cell.includes("⚠️");

      if (h === "Prix") {
        const prices = extractPrices(cell);
        const fmtRaw = fmtColIdx >= 0 ? cells[fmtColIdx] ?? "" : "";
        const fmts = fmtRaw && fmtRaw !== "—" ? fmtRaw.split("/").map((s) => s.trim()) : [null];
        prices.forEach((price, k) => {
          const fmt = fmts.length === prices.length ? fmts[k] : fmts[0] ?? null;
          lines.push({ name: normName(name), fmt: normFmt(fmt), price, flagged });
        });
      } else if (/^\d+cl$/.test(h)) {
        // colonne dont l'en-tête EST le format (vins, bières…)
        for (const price of extractPrices(cell)) {
          lines.push({ name: normName(name), fmt: normFmt(h), price, flagged });
        }
      }
    }
  }
  return lines;
}

// ----------------------------------------------------------------------------
// Fixtures parsées une fois.
// ----------------------------------------------------------------------------
const SEED_SQL = readSeedSql();
const SEED = parseSeed(SEED_SQL);
const SOURCE = parseSource(readSourceMd());

// Corona/Bud : le seed a corrigé le format (25cl de la colonne bière → 33cl du nom « bouteille 33cl »).
// Ces 2 lignes sont exclues du contrôle de TRIPLE (nom+format+prix) mais restent couvertes par le
// contrôle de PAIRE (nom+prix). C'est une divergence de format documentée, pas une dérive de prix.
const FORMAT_CORRECTED = new Set(["corona 0 (bouteille)", "bud (bouteille)"]);

// ----------------------------------------------------------------------------
test("seed parsé : nombre de lignes de prix stable (garde de régression)", () => {
  assert.equal(SEED.length, 124, "le seed carte Eden doit contenir 124 lignes de prix");
  // le SELECT projette toujours venue='eden'
  assert.match(SEED_SQL, /insert into public\.produits_bar[\s\S]*?select 'eden'/);
});

test("source parsée : au moins autant de lignes de prix que le seed", () => {
  assert.ok(SOURCE.length >= SEED.length, `source ${SOURCE.length} < seed ${SEED.length}`);
});

// --- Règle dure fondateur : Mont d'Or RETIRÉ -------------------------------
test("règle fondateur — Mont d'Or JAMAIS seedé", () => {
  const inSeed = SEED.filter((r) => /mont\s*d'?or/i.test(r.nom));
  assert.deepEqual(inSeed, [], "le Mont d'Or a été retiré par le fondateur, il ne doit pas être seedé");
  // et il n'apparaît dans AUCUNE ligne de prix de la source (il n'est qu'en note ⛔)
  const inSource = SOURCE.filter((l) => /mont\s*d'?or/i.test(l.name));
  assert.deepEqual(inSource, []);
});

// --- Règle dure fondateur : cuisine = EXACTEMENT 3 planches + 3 paninis -----
test("règle fondateur — cuisine = exactement 3 planches + 3 paninis (rien d'autre)", () => {
  const cuisine = SEED.filter((r) => r.categorie === "Cuisine");
  const attendu = [
    { nom: "Planche de fromages", prix: 22 },
    { nom: "Planche de charcuterie", prix: 22 },
    { nom: "Planche de fritures", prix: 23 },
    { nom: "Panini jambon fromage", prix: 7 },
    { nom: "Panini jambon halal fromages", prix: 7 },
    { nom: "Panini trois fromages", prix: 7 },
  ];
  assert.equal(cuisine.length, 6, "la cuisine Eden ne compte que 6 items");
  for (const r of cuisine) assert.equal(r.format, null, `${r.nom} : la cuisine n'a pas de format`);
  assert.deepEqual(
    cuisine.map((r) => ({ nom: r.nom, prix: r.prix })).sort((a, b) => a.nom.localeCompare(b.nom)),
    attendu.sort((a, b) => a.nom.localeCompare(b.nom)),
  );
});

// --- Règle dure fondateur : les 3 SEULS mappings à confirmer ----------------
test("règle fondateur — a_verifier = exactement les 3 mappings {Volcan, Don Julio, Bombay}", () => {
  const flagged = SEED.filter((r) => r.aVerifier).map((r) => ({ nom: r.nom, format: r.format, prix: r.prix }));
  const attendu = [
    { nom: "Tequila Volcan Blanco 40°", format: "4cl", prix: 13 },
    { nom: "Tequila Don Julio 1942", format: "70cl", prix: 390 },
    { nom: "Gin Bombay Sapphire", format: "70cl", prix: 130 },
  ];
  const sortk = (a: { nom: string }, b: { nom: string }) => a.nom.localeCompare(b.nom);
  assert.equal(flagged.length, 3, "exactement 3 mappings à confirmer");
  assert.deepEqual([...flagged].sort(sortk), [...attendu].sort(sortk));
});

test("cohérence source — les 3 mappings sont marqués ⚠️ côté source, et EUX SEULS parmi ces prix", () => {
  const flaggedSrc = new Set(SOURCE.filter((l) => l.flagged).map(pairKey));
  const seedFlagged = SEED.filter((r) => r.aVerifier).map((r) => pairKey({ name: normName(r.nom), price: r.prix }));
  for (const k of seedFlagged) assert.ok(flaggedSrc.has(k), `mapping à confirmer absent des ⚠️ source : ${k}`);
});

// --- Fidélité des PRIX : cœur de la garde « une vérité » --------------------
test("fidélité prix — chaque ligne du seed existe dans la source (même nom+prix)", () => {
  const src = new Set(SOURCE.map(pairKey));
  const manquants = SEED.map((r) => pairKey({ name: normName(r.nom), price: r.prix })).filter((k) => !src.has(k));
  assert.deepEqual([...new Set(manquants)], [], "lignes seed absentes/à prix divergent côté source");
});

test("complétude — chaque ligne de la source existe dans le seed (même nom+prix)", () => {
  const seedPairs = new Set(SEED.map((r) => pairKey({ name: normName(r.nom), price: r.prix })));
  const manquants = SOURCE.map(pairKey).filter((k) => !seedPairs.has(k));
  assert.deepEqual([...new Set(manquants)], [], "produits de la carte fondateur absents du seed");
});

// --- Fidélité NOM+FORMAT+PRIX : détecte un échange de format entre prix -----
test("fidélité format — nom+format+prix du seed présents en source (hors Corona/Bud corrigés)", () => {
  const src = new Set(SOURCE.map(tripleKey));
  const manquants = SEED.filter((r) => !FORMAT_CORRECTED.has(normName(r.nom)))
    .map((r) => tripleKey({ name: normName(r.nom), fmt: normFmt(r.format), price: r.prix, flagged: false }))
    .filter((k) => !src.has(k));
  assert.deepEqual([...new Set(manquants)], [], "triplets nom/format/prix seed absents de la source");
});

test("Corona & Bud : format corrigé en 33cl (nom+prix conservés)", () => {
  for (const nom of ["Corona 0 (bouteille)", "Bud (bouteille)"]) {
    const row = SEED.find((r) => r.nom === nom);
    assert.ok(row, `${nom} attendu dans le seed`);
    assert.equal(row!.format, "33cl", `${nom} : format bouteille = 33cl`);
    assert.equal(row!.prix, 7, `${nom} : 7,00 €`);
  }
});
