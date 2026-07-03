"use client";

// app/rooftop-3d-preview/page.tsx — ROUTE D'APERÇU ISOLÉE : PLAN CLIENT 3D « rooftop Eden » (site public).
//
// Raison d'être : le fondateur veut, pour le SITE public, le rooftop MODÉLISÉ en 3D navigable (Three.js/WebGL)
// — les 44 tables aux vraies positions, cabine DJ, banquettes/mobilier par type, mâts + toile, guirlandes,
// garde-corps vitré — où un client TAPE une table libre pour demander une résa. GO fondateur donné (2026-07-03 :
// « avec ce que je t'ai fourni tu vas pouvoir le faire »), brief obligatoire club-one-lab/reference-eden/BRIEF_3D_EDEN.md.
//
// Périmètre volontairement étroit et SÛR (même discipline que les autres routes -preview) :
//   · route additive, NOUVEAU segment — ne touche AUCUNE ligne du monolithe app/page.tsx ;
//   · géométrie 100 % DÉRIVÉE de lib/rooftop3d (pure, testée) à partir d'EDEN_SEED_V2 — aucune position inventée ;
//   · AUCUN réseau, AUCUN accès Supabase : la vraie demande passe par la RPC anon DURCIE (request_table_reservation
//     + anti-abus 0030, BLOQUANT avant prod) dans un chunk d'intégration séparé, LABO d'abord. Ici l'état des
//     tables vit en mémoire React et démarre TOUT LIBRE — aucune disponibilité fabriquée ;
//   · AUCUN envoi : « Demander cette table » marque la table « demandée » et rappelle que la confirmation de
//     SERVICE part manuellement (wa.me) — rien n'est expédié ;
//   · aucune mention d'alcool ; le rendu est STYLISÉ (palette golden hour), il ne publie JAMAIS les frames de
//     référence (visages clients → référence interne uniquement).
//
// WebGL absent → repli 2D (vue de dessus SVG des mêmes 44 tables, même fiche/flux). Moteur : Three.js (MIT, gratuit),
// contrôleur d'orbite/pincement écrit à la main (aucun addon three/examples). Ce n'est pas l'écran opérationnel :
// c'est le banc de démonstration du plan client 3D pour le fondateur.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import {
  DECK_DEPTH,
  DECK_LENGTH,
  ROOFTOP_PALETTE,
  describeRooftop,
  tableStateColor,
  type RooftopScene,
  type Table3D,
  type TableState,
} from "@/lib/rooftop3d";
import { TABLE_KIND_LABEL, capacityLabel } from "@/lib/venueTables";

// Scène déterministe (pure, sans DOM) — calculable côté serveur comme client.
const SCENE: RooftopScene = describeRooftop();

// ————————————————————————————————————————————————————————————————
// Constructeurs de meshes stylisés (utilisent THREE, aucun DOM) — pris depuis la spec pure
// ————————————————————————————————————————————————————————————————

function hexColor(h: number): THREE.Color {
  return new THREE.Color(h);
}

function buildDeck(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(DECK_LENGTH, 0.3, DECK_DEPTH);
  const mat = new THREE.MeshStandardMaterial({ color: hexColor(ROOFTOP_PALETTE.deckWood), roughness: 0.85, metalness: 0.02 });
  const deck = new THREE.Mesh(geo, mat);
  deck.position.y = -0.15;
  return deck;
}

// Suggestion de lattes : quelques fines lignes plus sombres dans le sens de la longueur (stylisé, léger).
function buildPlankLines(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: hexColor(0x7d6238), roughness: 0.9 });
  const count = 9;
  for (let i = 1; i < count; i += 1) {
    const z = -DECK_DEPTH / 2 + (DECK_DEPTH * i) / count;
    const line = new THREE.Mesh(new THREE.BoxGeometry(DECK_LENGTH, 0.02, 0.06), mat);
    line.position.set(0, 0.01, z);
    g.add(line);
  }
  return g;
}

function buildRailing(): THREE.Group {
  const g = new THREE.Group();
  const hx = DECK_LENGTH / 2;
  const hz = DECK_DEPTH / 2;
  const glass = new THREE.MeshStandardMaterial({
    color: hexColor(ROOFTOP_PALETTE.glassRail),
    transparent: true,
    opacity: 0.22,
    roughness: 0.1,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  const rail = new THREE.MeshStandardMaterial({ color: hexColor(ROOFTOP_PALETTE.mastWood), roughness: 0.8 });
  const sides: Array<{ w: number; d: number; x: number; z: number }> = [
    { w: DECK_LENGTH, d: 0.06, x: 0, z: -hz },
    { w: DECK_LENGTH, d: 0.06, x: 0, z: hz },
    { w: 0.06, d: DECK_DEPTH, x: -hx, z: 0 },
    { w: 0.06, d: DECK_DEPTH, x: hx, z: 0 },
  ];
  for (const s of sides) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(s.w, 1.1, s.d), glass);
    panel.position.set(s.x, 0.55, s.z);
    g.add(panel);
    const top = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.05, 0.08, s.d + 0.05), rail);
    top.position.set(s.x, 1.15, s.z);
    g.add(top);
  }
  return g;
}

function buildMasts(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: hexColor(ROOFTOP_PALETTE.mastWood), roughness: 0.8 });
  for (const m of SCENE.masts) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(m.central ? 0.22 : 0.15, m.central ? 0.26 : 0.18, m.height, 10), mat);
    mast.position.set(m.world.x, m.height / 2, m.world.z);
    g.add(mast);
  }
  return g;
}

// Toile tendue : dôme surbaissé crème (calotte de sphère), stylisé, double-face, légèrement translucide.
function buildCanopy(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(DECK_LENGTH * 0.62, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.28);
  const mat = new THREE.MeshStandardMaterial({
    color: hexColor(ROOFTOP_PALETTE.toileCream),
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  });
  const canopy = new THREE.Mesh(geo, mat);
  canopy.position.y = 4.6;
  canopy.scale.set(1, 1, DECK_DEPTH / DECK_LENGTH + 0.25);
  return canopy;
}

// Guirlandes : câble (ligne) + ampoules chaudes émissives réparties le long du câble.
function buildGuirlandes(): THREE.Group {
  const g = new THREE.Group();
  const wire = new THREE.LineBasicMaterial({ color: hexColor(0x3a3026) });
  const bulbMat = new THREE.MeshStandardMaterial({
    color: hexColor(ROOFTOP_PALETTE.warmLight),
    emissive: hexColor(ROOFTOP_PALETTE.warmLight),
    emissiveIntensity: 1.1,
    roughness: 0.4,
  });
  const bulbGeo = new THREE.SphereGeometry(0.09, 8, 8);
  for (const span of SCENE.guirlandes) {
    const pts = span.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wire);
    g.add(line);
    for (let i = 1; i < pts.length - 1; i += 2) {
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.copy(pts[i]);
      g.add(bulb);
    }
  }
  return g;
}

function buildDjBooth(): THREE.Group {
  const g = new THREE.Group();
  const { world, width, depth, height } = SCENE.djBooth;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color: hexColor(ROOFTOP_PALETTE.djBooth), roughness: 0.6 }),
  );
  body.position.set(world.x, height / 2, world.z);
  g.add(body);
  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.9, 0.06, depth * 0.9),
    new THREE.MeshStandardMaterial({
      color: hexColor(ROOFTOP_PALETTE.nightBlue),
      emissive: hexColor(ROOFTOP_PALETTE.nightBlue),
      emissiveIntensity: 0.9,
    }),
  );
  glow.position.set(world.x, height + 0.05, world.z);
  g.add(glow);
  return g;
}

// Un mange-debout / une table / un canapé / un olivier — Group avec userData.label pour le picking.
function buildTableGroup(t: Table3D): THREE.Group {
  const g = new THREE.Group();
  g.position.set(t.world.x, 0, t.world.z);
  g.userData.label = t.label;
  const geoTop = t.geometry.topColor;
  if (t.geometry.footprint === "square") {
    // Canapé : banquette basse écrue + dossier + table basse bois devant.
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(t.geometry.radius * 2, t.geometry.height * 0.55, t.geometry.radius * 1.4),
      new THREE.MeshStandardMaterial({ color: hexColor(geoTop), roughness: 0.95 }),
    );
    seat.position.y = t.geometry.height * 0.28;
    g.add(seat);
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(t.geometry.radius * 2, t.geometry.height * 0.7, 0.18),
      new THREE.MeshStandardMaterial({ color: hexColor(geoTop), roughness: 0.95 }),
    );
    back.position.set(0, t.geometry.height * 0.5, -t.geometry.radius * 0.6);
    g.add(back);
    const lowTable = new THREE.Mesh(
      new THREE.BoxGeometry(t.geometry.radius * 1.1, 0.12, t.geometry.radius * 0.9),
      new THREE.MeshStandardMaterial({ color: hexColor(ROOFTOP_PALETTE.deckWood), roughness: 0.8 }),
    );
    lowTable.position.set(0, 0.35, t.geometry.radius * 0.9);
    g.add(lowTable);
  } else {
    // Table ronde (modulable / olivier / haute) : plateau + pied.
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(t.geometry.radius, t.geometry.radius, 0.08, 20),
      new THREE.MeshStandardMaterial({
        color: hexColor(geoTop),
        roughness: t.kind === "modulable" ? 0.35 : 0.7,
        metalness: t.kind === "modulable" ? 0.25 : 0.05,
      }),
    );
    top.position.y = t.geometry.height;
    g.add(top);
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.09, t.geometry.height, 8),
      new THREE.MeshStandardMaterial({ color: hexColor(ROOFTOP_PALETTE.mastWood), roughness: 0.8 }),
    );
    leg.position.y = t.geometry.height / 2;
    g.add(leg);
    if (t.geometry.hasOliveTree) {
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.24, 0.4, 10),
        new THREE.MeshStandardMaterial({ color: hexColor(ROOFTOP_PALETTE.planter), roughness: 0.9 }),
      );
      pot.position.set(t.geometry.radius + 0.35, 0.2, 0);
      g.add(pot);
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.07, 0.7, 6),
        new THREE.MeshStandardMaterial({ color: hexColor(0x6b5233), roughness: 0.9 }),
      );
      trunk.position.set(t.geometry.radius + 0.35, 0.75, 0);
      g.add(trunk);
      const foliage = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 10, 10),
        new THREE.MeshStandardMaterial({ color: hexColor(ROOFTOP_PALETTE.olive), roughness: 1 }),
      );
      foliage.position.set(t.geometry.radius + 0.35, 1.3, 0);
      g.add(foliage);
    }
  }
  return g;
}

// Anneau d'état au sol (halo lisible sans texte) — recoloré selon l'état réel de la table.
function buildStateRing(t: Table3D): THREE.Mesh {
  const r = t.geometry.radius;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r + 0.12, r + 0.32, 28),
    new THREE.MeshBasicMaterial({ color: hexColor(tableStateColor("libre")), side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(t.world.x, 0.02, t.world.z);
  return ring;
}

// ————————————————————————————————————————————————————————————————
// Composant
// ————————————————————————————————————————————————————————————————

export default function Rooftop3dPreviewPage() {
  // Rendu 3D par défaut (markup identique serveur ↔ premier rendu client → aucun mismatch d'hydratation).
  // On ne bascule en 2D QUE si l'init WebGL échoue réellement (voie d'erreur de l'effet de construction).
  const [use2D, setUse2D] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, TableState>>(() =>
    Object.fromEntries(SCENE.tables.map((t) => [t.label, "libre" as TableState])),
  );

  const mountRef = useRef<HTMLDivElement | null>(null);
  const ringByLabelRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const tablePosRef = useRef<Map<string, THREE.Vector3>>(new Map());
  const selectionRingRef = useRef<THREE.Mesh | null>(null);

  const selectedTable = useMemo(
    () => SCENE.tables.find((t) => t.label === selectedLabel) ?? null,
    [selectedLabel],
  );

  // Construction de la scène 3D (une seule fois, au montage). Si l'init WebGL échoue → repli 2D.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 520;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      // WebGL indisponible → repli 2D. Déféré (microtask) : réaction à une sonde de système externe,
      // pas un setState synchrone d'effet — le rendu de repli se fait au tick suivant.
      queueMicrotask(() => setUse2D(true));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.display = "block";
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = hexColor(ROOFTOP_PALETTE.skyPeach);
    scene.fog = new THREE.Fog(ROOFTOP_PALETTE.skyPeach, DECK_LENGTH * 0.9, DECK_LENGTH * 2.4);

    const camera = new THREE.PerspectiveCamera(SCENE.camera.fov, width / height, 0.1, 400);
    const target = new THREE.Vector3(SCENE.camera.target.x, SCENE.camera.target.y, SCENE.camera.target.z);

    // Lumière golden hour.
    scene.add(new THREE.HemisphereLight(ROOFTOP_PALETTE.skyPeach, ROOFTOP_PALETTE.skyGround, 0.9));
    const sun = new THREE.DirectionalLight(ROOFTOP_PALETTE.warmLight, 1.15);
    sun.position.set(-DECK_LENGTH * 0.5, 12, -DECK_DEPTH * 0.8);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));

    // Décor fixe.
    scene.add(buildDeck());
    scene.add(buildPlankLines());
    scene.add(buildRailing());
    scene.add(buildMasts());
    scene.add(buildCanopy());
    scene.add(buildGuirlandes());
    scene.add(buildDjBooth());

    // Tables + anneaux d'état.
    const pickTargets: THREE.Object3D[] = [];
    const ringMap = new Map<string, THREE.Mesh>();
    const posMap = new Map<string, THREE.Vector3>();
    for (const t of SCENE.tables) {
      const group = buildTableGroup(t);
      scene.add(group);
      pickTargets.push(group);
      const ring = buildStateRing(t);
      scene.add(ring);
      ringMap.set(t.label, ring);
      posMap.set(t.label, new THREE.Vector3(t.world.x, t.geometry.height + 0.4, t.world.z));
    }
    ringByLabelRef.current = ringMap;
    tablePosRef.current = posMap;

    // Anneau de sélection (blanc), masqué au départ.
    const selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.9, 30),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.visible = false;
    scene.add(selectionRing);
    selectionRingRef.current = selectionRing;

    // —— Contrôleur d'orbite / pincement écrit à la main (aucun addon) ——
    const initOffset = new THREE.Vector3(
      SCENE.camera.position.x - target.x,
      SCENE.camera.position.y - target.y,
      SCENE.camera.position.z - target.z,
    );
    let radius = initOffset.length();
    let theta = Math.atan2(initOffset.x, initOffset.z);
    let phi = Math.acos(THREE.MathUtils.clamp(initOffset.y / radius, -1, 1));
    const PHI_MIN = 0.18;
    const PHI_MAX = 1.45;
    const R_MIN = 12;
    const R_MAX = 80;

    const pointers = new Map<number, { x: number; y: number }>();
    let downPos: { x: number; y: number } | null = null;
    let dragged = false;
    let pinchDist = 0;

    function applyCamera() {
      const sinPhi = Math.sin(phi);
      camera.position.set(
        target.x + radius * sinPhi * Math.sin(theta),
        target.y + radius * Math.cos(phi),
        target.z + radius * sinPhi * Math.cos(theta),
      );
      camera.lookAt(target);
    }
    applyCamera();

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    function pick(clientX: number, clientY: number) {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(pickTargets, true);
      if (hits.length === 0) {
        setSelectedLabel(null);
        return;
      }
      let obj: THREE.Object3D | null = hits[0].object;
      while (obj && !obj.userData.label) obj = obj.parent;
      setSelectedLabel(obj && typeof obj.userData.label === "string" ? obj.userData.label : null);
    }

    function onPointerDown(e: PointerEvent) {
      renderer.domElement.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      downPos = { x: e.clientX, y: e.clientY };
      dragged = false;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    }
    function onPointerMove(e: PointerEvent) {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId)!;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) {
          radius = THREE.MathUtils.clamp(radius * (pinchDist / d), R_MIN, R_MAX);
          applyCamera();
        }
        pinchDist = d;
        dragged = true;
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
      theta -= dx * 0.005;
      phi = THREE.MathUtils.clamp(phi - dy * 0.005, PHI_MIN, PHI_MAX);
      applyCamera();
    }
    function onPointerUp(e: PointerEvent) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (!dragged && downPos) pick(downPos.x, downPos.y);
      downPos = null;
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      radius = THREE.MathUtils.clamp(radius * (e.deltaY > 0 ? 1.08 : 0.92), R_MIN, R_MAX);
      applyCamera();
    }

    const el = renderer.domElement;
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("wheel", onWheel, { passive: false });

    function onResize() {
      const w = mount!.clientWidth || 800;
      const h = mount!.clientHeight || 520;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", onResize);

    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      renderer.render(scene, camera);
    };
    render();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("wheel", onWheel);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) (mat as THREE.Material).dispose();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      ringByLabelRef.current = new Map();
      tablePosRef.current = new Map();
      selectionRingRef.current = null;
    };
  }, []);

  // Recoloration des anneaux d'état quand l'état réel des tables change (3D ; no-op en repli 2D).
  useEffect(() => {
    if (use2D) return;
    for (const [label, ring] of ringByLabelRef.current) {
      const mat = ring.material as THREE.MeshBasicMaterial;
      mat.color.setHex(tableStateColor(states[label] ?? "libre"));
    }
  }, [states, use2D]);

  // Positionnement de l'anneau de sélection (3D ; no-op en repli 2D).
  useEffect(() => {
    if (use2D) return;
    const sel = selectionRingRef.current;
    if (!sel) return;
    if (selectedLabel && tablePosRef.current.has(selectedLabel)) {
      const p = tablePosRef.current.get(selectedLabel)!;
      sel.position.set(p.x, 0.04, p.z);
      sel.visible = true;
    } else {
      sel.visible = false;
    }
  }, [selectedLabel, use2D]);

  function requestTable(label: string) {
    setStates((prev) => ({ ...prev, [label]: "demandee" }));
  }
  function resetTable(label: string) {
    setStates((prev) => ({ ...prev, [label]: "libre" }));
  }

  const counts = useMemo(() => {
    let libre = 0;
    let demandee = 0;
    for (const t of SCENE.tables) {
      const s = states[t.label] ?? "libre";
      if (s === "libre") libre += 1;
      else if (s === "demandee") demandee += 1;
    }
    return { libre, demandee, total: SCENE.tables.length };
  }, [states]);

  return (
    <main style={S.page}>
      <header style={S.header}>
        <h1 style={S.h1}>Rooftop Eden — plan client 3D (aperçu)</h1>
        <p style={S.sub}>
          Les 44 tables réelles aux vraies positions (EDEN_SEED_V2). Tape une table pour voir sa fiche et
          demander une résa. Banc de démonstration : aucun envoi, aucune donnée client — l&apos;état démarre
          tout libre.
        </p>
      </header>

      <section style={S.stage}>
        {!use2D && <div ref={mountRef} style={S.canvasMount} />}

        {use2D && <Fallback2D states={states} selectedLabel={selectedLabel} onPick={setSelectedLabel} />}

        {/* Légende d'états (lisible sans texte dans la scène, rappelée ici). */}
        <div style={S.legend}>
          <LegendDot color={tableStateColor("libre")} label={`Libre (${counts.libre})`} />
          <LegendDot color={tableStateColor("demandee")} label={`Demandée (${counts.demandee})`} />
          <LegendDot color={tableStateColor("indisponible")} label="Indisponible" />
        </div>
      </section>

      <section style={S.fiche}>
        {selectedTable ? (
          <TableFiche
            table={selectedTable}
            state={states[selectedTable.label] ?? "libre"}
            onRequest={() => requestTable(selectedTable.label)}
            onReset={() => resetTable(selectedTable.label)}
          />
        ) : (
          <p style={S.hint}>
            {use2D
              ? "WebGL indisponible — repli en vue de dessus 2D. Tape une table pour sa fiche."
              : "Tape une table du rooftop pour ouvrir sa fiche."}
          </p>
        )}
      </section>

      <footer style={S.footer}>
        Aperçu isolé — ne touche pas le monolithe. La vraie demande passera par la RPC anon durcie (anti-abus
        0030, LABO d&apos;abord). Aucune confirmation n&apos;est envoyée ici : le service confirme manuellement.
      </footer>
    </main>
  );
}

// ————————————————————————————————————————————————————————————————
// Fiche table (2D & 3D partagée)
// ————————————————————————————————————————————————————————————————

function TableFiche(props: {
  table: Table3D;
  state: TableState;
  onRequest: () => void;
  onReset: () => void;
}) {
  const { table, state } = props;
  return (
    <div style={S.ficheCard}>
      <div style={S.ficheHead}>
        <span style={S.ficheLabel}>Table {table.label}</span>
        <span style={{ ...S.badge, background: `#${tableStateColor(state).toString(16).padStart(6, "0")}` }}>
          {state === "libre" ? "libre" : state === "demandee" ? "demandée" : "indisponible"}
        </span>
      </div>
      <dl style={S.dl}>
        <div style={S.row}>
          <dt style={S.dt}>Type</dt>
          <dd style={S.dd}>{TABLE_KIND_LABEL[table.kind]}</dd>
        </div>
        <div style={S.row}>
          <dt style={S.dt}>Assise</dt>
          <dd style={S.dd}>{table.standing ? "debout (groupe, sans chaise)" : "assise"}</dd>
        </div>
        <div style={S.row}>
          <dt style={S.dt}>Capacité</dt>
          <dd style={S.dd}>{table.standing ? "—" : `${capacityLabel(table.capacity)} pers`}</dd>
        </div>
      </dl>
      {state === "libre" ? (
        <button type="button" style={S.cta} onClick={props.onRequest}>
          Demander cette table
        </button>
      ) : (
        <div style={S.demRow}>
          <span style={S.demNote}>Demande enregistrée (banc). Confirmation de service manuelle (wa.me).</span>
          <button type="button" style={S.reset} onClick={props.onReset}>
            Annuler la demande
          </button>
        </div>
      )}
    </div>
  );
}

function LegendDot(props: { color: number; label: string }) {
  return (
    <span style={S.legendItem}>
      <span style={{ ...S.dot, background: `#${props.color.toString(16).padStart(6, "0")}` }} />
      {props.label}
    </span>
  );
}

// ————————————————————————————————————————————————————————————————
// Repli 2D — vue de dessus SVG (mêmes 44 tables, même flux)
// ————————————————————————————————————————————————————————————————

function Fallback2D(props: {
  states: Record<string, TableState>;
  selectedLabel: string | null;
  onPick: (label: string | null) => void;
}) {
  const VW = 960;
  const VH = Math.round(VW * (DECK_DEPTH / DECK_LENGTH));
  const toX = (x: number) => ((x + DECK_LENGTH / 2) / DECK_LENGTH) * VW;
  const toY = (z: number) => ((z + DECK_DEPTH / 2) / DECK_DEPTH) * VH;
  const dj = SCENE.djBooth;
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={S.svg} role="img" aria-label="Vue de dessus du rooftop Eden">
      <rect x={0} y={0} width={VW} height={VH} fill="#151019" />
      <rect x={2} y={2} width={VW - 4} height={VH - 4} fill="none" stroke="#3a2f22" strokeWidth={3} />
      {/* Cabine DJ */}
      <rect
        x={toX(dj.world.x) - 22}
        y={toY(dj.world.z) - 14}
        width={44}
        height={28}
        rx={4}
        fill="#2b2b30"
        stroke="#3d5a8a"
        strokeWidth={2}
      />
      <text x={toX(dj.world.x)} y={toY(dj.world.z) + 4} fill="#9fb0d0" fontSize={11} textAnchor="middle">
        DJ
      </text>
      {SCENE.tables.map((t) => {
        const state = props.states[t.label] ?? "libre";
        const color = `#${tableStateColor(state).toString(16).padStart(6, "0")}`;
        const cx = toX(t.world.x);
        const cy = toY(t.world.z);
        const selected = props.selectedLabel === t.label;
        const r = t.geometry.footprint === "square" ? 15 : t.kind === "olivier" ? 13 : t.kind === "haute" ? 9 : 11;
        return (
          <g key={t.label} onClick={() => props.onPick(t.label)} style={{ cursor: "pointer" }}>
            {t.geometry.footprint === "square" ? (
              <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} rx={3} fill={color} stroke={selected ? "#fff" : "#00000055"} strokeWidth={selected ? 3 : 1} />
            ) : (
              <circle cx={cx} cy={cy} r={r} fill={color} stroke={selected ? "#fff" : "#00000055"} strokeWidth={selected ? 3 : 1} />
            )}
            <text x={cx} y={cy + 3} fill="#10131a" fontSize={9} textAnchor="middle" fontWeight={600}>
              {t.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ————————————————————————————————————————————————————————————————
// Styles (inline, cohérents avec les autres bancs -preview : sombre Club One)
// ————————————————————————————————————————————————————————————————

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", background: "#0c0a10", color: "#efe7d8", fontFamily: "system-ui, sans-serif", padding: "16px", maxWidth: 1100, margin: "0 auto" },
  header: { marginBottom: 12 },
  h1: { fontSize: 20, margin: "0 0 4px", color: "#f4d68a" },
  sub: { fontSize: 13, lineHeight: 1.5, margin: 0, color: "#b7ad9a" },
  stage: { position: "relative", borderRadius: 12, overflow: "hidden", border: "1px solid #2a2333", background: "#151019" },
  canvasMount: { width: "100%", height: "min(60dvh, 520px)" },
  svg: { width: "100%", height: "auto", display: "block", background: "#151019" },
  legend: { position: "absolute", left: 10, bottom: 10, display: "flex", gap: 12, flexWrap: "wrap", background: "#0c0a10cc", padding: "6px 10px", borderRadius: 8, fontSize: 12 },
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6 },
  dot: { width: 11, height: 11, borderRadius: "50%", display: "inline-block" },
  fiche: { marginTop: 14 },
  hint: { fontSize: 13, color: "#b7ad9a", margin: 0 },
  ficheCard: { border: "1px solid #2a2333", borderRadius: 12, padding: 14, background: "#141019" },
  ficheHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  ficheLabel: { fontSize: 17, fontWeight: 700, color: "#f4d68a" },
  badge: { fontSize: 11, fontWeight: 700, color: "#10131a", padding: "3px 9px", borderRadius: 999, textTransform: "uppercase", letterSpacing: 0.4 },
  dl: { margin: "0 0 12px", display: "grid", gap: 6 },
  row: { display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid #221c2b", paddingBottom: 5 },
  dt: { fontSize: 12, color: "#8f8677", margin: 0 },
  dd: { fontSize: 13, margin: 0, textAlign: "right", color: "#efe7d8" },
  cta: { width: "100%", minHeight: 48, borderRadius: 10, border: "none", background: "#3fae82", color: "#06130d", fontSize: 15, fontWeight: 700, cursor: "pointer" },
  demRow: { display: "flex", flexDirection: "column", gap: 8 },
  demNote: { fontSize: 12, color: "#e0a94a" },
  reset: { minHeight: 44, borderRadius: 10, border: "1px solid #3a2f22", background: "transparent", color: "#b7ad9a", fontSize: 13, cursor: "pointer" },
  footer: { marginTop: 16, fontSize: 11, lineHeight: 1.5, color: "#6f685c" },
};
