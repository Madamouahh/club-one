// tests/migrationsRegistry.test.mts — GARDE D'INTÉGRITÉ DU NUMÉROTAGE DES MIGRATIONS.
//
// Croise l'état RÉEL de `supabase/migrations/` et `supabase/verification/` avec le registre
// in-repo `docs/MIGRATIONS_REGISTRY.md` (tradition « deux sources, une vérité » du dépôt :
// venueTables ↔ 0031, carteEden seed ↔ docs). Cette garde MORD sur :
//   · un nom de fichier hors convention `NNNN_slug.sql` ;
//   · TOUT numéro en double (la collision 0032 a été RÉSOLUE au paquet de bascule prod :
//     active_event_venue renuméroté 0032 → 0052 ; produits_bar garde 0032) ;
//   · un trou dans la séquence 0000..N ;
//   · une migration non listée dans le registre (ou une ligne fantôme du registre) ;
//   · une migration ≥ 0010 sans fichier de vérification non déclarée comme trou connu.
//
// Niveau de preuve : 3 (statique, système de fichiers ↔ markdown). Ne prouve PAS l'exécution
// PostgreSQL des migrations (niveau 4 : fichiers supabase/verification/, LABO uniquement).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGR_DIR = join(process.cwd(), "supabase", "migrations");
const VERIF_DIR = join(process.cwd(), "supabase", "verification");
const REGISTRY = join(process.cwd(), "docs", "MIGRATIONS_REGISTRY.md");

const migrationFiles = readdirSync(MIGR_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const verifFiles = readdirSync(VERIF_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const registryText = readFileSync(REGISTRY, "utf8");

// NNNN_slug.sql — minuscules/chiffres/underscore uniquement.
const NAME_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;

function migNumber(file: string): number {
  const m = NAME_RE.exec(file);
  if (!m) throw new Error(`nom hors convention: ${file}`);
  return Number(m[1]);
}

// Numéros (4 chiffres) présents comme token dans un basename (gère 0014_0015_… combiné).
function numberTokens(file: string): Set<number> {
  const out = new Set<number>();
  for (const tok of file.split(/[_.]/)) {
    if (/^\d{4}$/.test(tok)) out.add(Number(tok));
  }
  return out;
}

// ── FAITS ATTENDUS (dérivés de l'état réel du dépôt, documentés dans le registre) ──────────

// Collision 0032 RÉSOLUE au paquet de bascule prod (active_event_venue → 0052 ; produits_bar garde
// 0032). Plus AUCUNE collision tolérée : réintroduire un doublon casse le test. cf. §3 du registre.
const KNOWN_COLLISIONS: Record<number, string[]> = {};

// Migrations ≥ 0010 dont le NUMÉRO n'a AUCUN fichier de vérification (cf. §4 du registre).
// S78 (2026-07-04) : 0020/0021 ont désormais leur vérification niveau 4 (LABO) → plus AUCUN trou
// au niveau NUMÉRO. S79 (2026-07-04) : active_event_venue a une vérif DÉDIÉE (renuméroté au paquet
// prod → `0052_active_event_venue_verification.sql`) → plus AUCUN trou au niveau FICHIER non plus.
// Ajouter une migration ≥ 0010 sans vérif, sans l'inscrire ici ET dans le registre, casse le test.
const KNOWN_VERIF_GAPS_GTE_0010: string[] = [];

// ── A. Convention de nommage ───────────────────────────────────────────────────────────────
test("A · chaque migration respecte NNNN_slug.sql", () => {
  const bad = migrationFiles.filter((f) => !NAME_RE.test(f));
  assert.deepEqual(bad, [], `noms hors convention: ${bad.join(", ")}`);
});

// ── B. Doublons de numéro : AUCUN (collision 0032 résolue §3) ────────────────────────────────
test("B · aucun numéro en double (collision 0032 résolue au paquet prod)", () => {
  const byNumber = new Map<number, string[]>();
  for (const f of migrationFiles) {
    const n = migNumber(f);
    byNumber.set(n, [...(byNumber.get(n) ?? []), f]);
  }
  const duplicates: Record<number, string[]> = {};
  for (const [n, files] of byNumber) {
    if (files.length > 1) duplicates[n] = files.sort();
  }
  assert.deepEqual(
    duplicates,
    KNOWN_COLLISIONS,
    "un doublon de numéro est apparu (la collision 0032 doit rester résolue : active_event_venue=0052, produits_bar=0032)",
  );
});

// ── C. Séquence contiguë 0000..max, sans trou ───────────────────────────────────────────────
test("C · la séquence de numéros est contiguë de 0000 au dernier", () => {
  const numbers = new Set(migrationFiles.map(migNumber));
  const max = Math.max(...numbers);
  assert.equal(Math.min(...numbers), 0, "la séquence doit démarrer à 0000");
  const missing: string[] = [];
  for (let i = 0; i <= max; i++) {
    if (!numbers.has(i)) missing.push(String(i).padStart(4, "0"));
  }
  assert.deepEqual(missing, [], `trou(s) dans la séquence: ${missing.join(", ")}`);
});

// ── D. Registre ↔ migrations : bijection (deux sources, une vérité) ─────────────────────────
test("D · le registre liste EXACTEMENT les fichiers de migration réels", () => {
  // Tous les tokens `NNNN_….sql` cités dans le markdown, hors fichiers de vérification
  // (le §4 cite aussi des noms `…_verification.sql` / preflight / postflight).
  const cited = new Set(
    (registryText.match(/\b\d{4}_[a-z0-9_]+\.sql\b/g) ?? []).filter(
      (f) => !/(verification|preflight|postflight|readonly)/i.test(f),
    ),
  );
  const real = new Set(migrationFiles);

  const undocumented = [...real].filter((f) => !cited.has(f)).sort();
  const phantom = [...cited].filter((f) => !real.has(f)).sort();

  assert.deepEqual(undocumented, [], `migration non documentée dans le registre: ${undocumented.join(", ")}`);
  assert.deepEqual(phantom, [], `ligne fantôme du registre (fichier absent): ${phantom.join(", ")}`);
});

// ── E. Couverture vérification : les trous ≥ 0010 sont exactement ceux déclarés ─────────────
test("E · les migrations ≥ 0010 sans vérification = trous connus déclarés (§4)", () => {
  const verifNumbers = new Set<number>();
  for (const vf of verifFiles) for (const n of numberTokens(vf)) verifNumbers.add(n);

  const gaps = migrationFiles
    .filter((f) => migNumber(f) >= 10)
    .filter((f) => !verifNumbers.has(migNumber(f)))
    .sort();

  assert.deepEqual(
    gaps,
    [...KNOWN_VERIF_GAPS_GTE_0010].sort(),
    "un trou de vérification ≥ 0010 est apparu ou a été comblé sans MAJ du registre/test",
  );
});

// ── F. Aucun fichier de vérification orphelin (référence un numéro de migration inexistant) ──
test("F · chaque fichier de vérification à préfixe numérique cible une migration réelle", () => {
  const realNumbers = new Set(migrationFiles.map(migNumber));
  const orphans: string[] = [];
  for (const vf of verifFiles) {
    const toks = numberTokens(vf);
    if (toks.size === 0) continue; // vérif à nom historique (phase0b/atomic) : hors périmètre numérique
    for (const n of toks) {
      if (!realNumbers.has(n)) orphans.push(`${vf} → ${String(n).padStart(4, "0")}`);
    }
  }
  assert.deepEqual(orphans, [], `vérification orpheline: ${orphans.join(", ")}`);
});

// ── G. Ancre doc↔disque↔test : résolution collision documentée + vérif dédiée de 0052_active_event_venue ─
test("G · le registre documente la résolution de la collision 0032 et la vérif dédiée de 0052_active_event_venue existe", () => {
  // Après renumérotation, le registre mentionne 0052_active_event_venue (table + §3 résolution).
  assert.ok(
    registryText.includes("0052_active_event_venue.sql"),
    "le registre doit mentionner 0052_active_event_venue.sql",
  );
  // La section collision (résolue) doit exister (le mot-clé "Collision" du titre §3).
  assert.ok(/Collision de num/i.test(registryText), "le registre doit documenter la collision de numéro (résolue)");
  // Verrou POSITIF — la vérif DÉDIÉE de active_event_venue est bien sur disque sous son nouveau nom.
  assert.ok(
    verifFiles.includes("0052_active_event_venue_verification.sql"),
    "la vérification dédiée 0052_active_event_venue_verification.sql doit exister",
  );
});
