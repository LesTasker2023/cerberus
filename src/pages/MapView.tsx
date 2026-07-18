import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import type { useAsteroids } from "../hooks/useAsteroids";
import type { useEncounters } from "../hooks/useEncounters";
import type { usePois, Poi } from "../hooks/usePois";
import type { PlayerPos } from "../hooks/usePlayerPosition";
import type { ClanLocation } from "../lib/locations";
import { combinePois } from "../lib/pois";
import { MapDetail, type MapPoi } from "../components/MapDetail";
import { PoiEditor } from "../components/PoiEditor";

const CAT_COLOR: Record<string, number> = {
  station: 0x46b0c4,
  "space-station": 0x5ec8d8,
  "warp-gate": 0xb98cff,
  landmark: 0xd9a441,
  "asteroid-m": 0x3f7fff,
  "asteroid-c": 0xb08a55,
  "asteroid-f": 0x5aa06a,
  "asteroid-s": 0x6f96ad,
  "asteroid-nd": 0xa86fc0,
  "asteroid-scrap": 0x8a8f99,
  "outlaw-zone": 0x84cc16,
  mob: 0xf2683c,
  player: 0xff4d6d, // logged players / hostiles
};
const M_BARE = 0x3f78c0; // belt-anchor skeleton — tactical steel-blue, not grey

/** Logged mobs within this many EU units of each other belong to the same spawn
 *  area (single-link). Above it, a separate spawn sphere is drawn — so hunting a
 *  new mob in another sector doesn't stretch one sphere across the map. */
const MOB_CLUSTER_EU = 3000;

/* ── Roman-numeral size helpers ── */
function romanToInt(s: string): number {
  const m: Record<string, number> = { I: 1, V: 5, X: 10, L: 50 };
  let t = 0;
  for (let i = 0; i < s.length; i++) {
    const c = m[s[i]] ?? 0;
    const n = m[s[i + 1]] ?? 0;
    t += c < n ? -c : c;
  }
  return t;
}
function intToRoman(n: number): string {
  const v: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let r = "";
  for (const [x, sym] of v) while (n >= x) ((r += sym), (n -= x));
  return r;
}
/** Size 1..20 parsed from a name's trailing roman numeral, or null. */
function sizeOf(name: string): number | null {
  const m = name.match(/\b([IVXL]+)\b/i);
  return m ? romanToInt(m[1].toUpperCase()) : null;
}
// Bare "M" anchors are the belt skeleton — named just "M" (any category).
const isBareM = (p: MapPoi) => /^m$/i.test(p.name.trim());

/** Label only stations, outlaw zones, and the user's logged rocks. The context
 *  asteroid field stays as unlabelled dots to avoid a wall of text. */
const LABELLED = new Set(["station", "space-station", "warp-gate", "landmark", "outlaw-zone", "player"]);
function labelFor(p: MapPoi): string | null {
  if (LABELLED.has(p.category)) return p.name;
  // Label named mob zones (context / manually-added), but not the individual
  // logged-encounter kill dots (their ids start "mob-") which would clutter.
  if (p.category === "mob") return p.id.startsWith("mob-") ? null : p.name;
  if (!p.logged) return null;
  if (p.category === "asteroid-m") {
    const s = sizeOf(p.name);
    return s ? intToRoman(s) : "M";
  }
  return p.name;
}

/** The seven map filter groups (order = display order), with swatch colour. */
const FILTERS: { key: string; label: string; color: string }[] = [
  { key: "space-station", label: "Space Stations", color: "#5ec8d8" },
  { key: "warp-gate", label: "Warp Gates", color: "#b98cff" },
  { key: "asteroid", label: "Asteroids", color: "#3f78c0" },
  { key: "mob", label: "Mob Zones", color: "#f2683c" },
  { key: "outlaw-zone", label: "Outlaw Zones", color: "#84cc16" },
  { key: "player", label: "Players", color: "#ff4d6d" },
  { key: "misc", label: "Misc", color: "#8a8f99" },
];

/* ── In-game 4×3 sector grid (B2–E4), ported from delta's space map. Cells are
 *  10 000 EU, the grid centred on 73000/68500, cols B–E, rows 2–4. Anchored to
 *  absolute EU coords, so drawing it through euToThree registers it with POIs. */
const GRID_CELL_EU = 10000;
const GRID_ORIGIN_EU = { x: 53000, y: 53500 }; // top-left corner (col B, row 2)
const GRID_COLS = 4;
const GRID_ROWS = 3;
const GRID_COL_LETTERS = ["B", "C", "D", "E"];
const GRID_ROW_NUMS = [2, 3, 4];
/** [col, row] of the PvP grid cells — C2, C3, D3, E2. */
const GRID_PVP_CELLS: [number, number][] = [[1, 0], [1, 1], [2, 1], [3, 0]];

/** Map a POI to its filter group (one of FILTERS' keys). */
function filterGroupOf(p: MapPoi): string {
  const c = p.category;
  if (c === "space-station" || c === "station") return "space-station";
  if (c === "warp-gate") return "warp-gate";
  if (c.startsWith("asteroid")) return "asteroid"; // all asteroid types + M anchors
  if (c === "mob") return "mob";
  if (c === "outlaw-zone") return "outlaw-zone";
  if (c === "player") return "player";
  return "misc"; // landmarks + anything else
}

/** Raw coord units per one in-game AU — calibrated from two known waypoints
 *  (Δ≈499 raw ⇒ game shows 0.500 AU). */
const EU_PER_AU = 1000;
const fmtDist = (v: number) => `${(v / EU_PER_AU).toFixed(3)} AU`;

/** Travel-time model. `SHIP_SPEED_KMH` is the in-game HUD speed readout, whose
 *  "km/h" unit doesn't match the map's AU distance — `SPEED_UNIT_SCALE` converts
 *  it, calibrated from a constant-speed (rolling-start) run: 0.500 AU in 28.9 s
 *  at a HUD 90 km/h ⇒ 62.3 AU/h, i.e. 62.3/90 ≈ 0.69. Because that run held max
 *  speed, the fit is linear and holds at any distance. */
const SHIP_SPEED_KMH = 90;
const SPEED_UNIT_SCALE = 0.69;
const etaSeconds = (au: number) => (au / (SHIP_SPEED_KMH * SPEED_UNIT_SCALE)) * 3600;
const fmtEta = (s: number) => {
  const t = Math.round(s);
  if (t < 60) return `${t}s`;
  return `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, "0")}s`;
};

function euToThree(
  x: number,
  y: number,
  z: number,
  c: { x: number; y: number; z: number },
  s: number,
): THREE.Vector3 {
  return new THREE.Vector3((x - c.x) * s, (z - c.z) * s, -(y - c.y) * s);
}

/** World-height multiplier applied per-frame as `size = distance × this`, which
 *  cancels perspective so a label holds one on-screen size at any zoom. Bigger
 *  value = bigger labels. User-adjustable via the map slider (persisted). */
const LABEL_SIZE_DEFAULT = 0.04;
const LABEL_SIZE_MIN = 0.015;
const LABEL_SIZE_MAX = 0.12;
const LABEL_STORE_KEY = "cerberus.labelSize";

/** All markers are built at one base radius and scaled uniformly by the marker
 *  slider (very small → normal), persisted per machine. */
const MARKER_BASE = 0.03;
const MARKER_SCALE_DEFAULT = 0.5;
const MARKER_SCALE_MIN = 0.15;
const MARKER_SCALE_MAX = 1;
const MARKER_STORE_KEY = "cerberus.markerScale";

/** Render a label to a canvas texture: text on a translucent dark pill with a
 *  faint coloured border, so it stays legible over bright fields. */
function drawLabelTexture(text: string, color: string): { tex: THREE.CanvasTexture; aspect: number } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = "600 60px 'IBM Plex Mono', monospace";
  ctx.font = font;
  const padX = 32;
  const w = Math.ceil(ctx.measureText(text).width + padX * 2);
  const h = 96;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;

  // Rounded-rect pill.
  const r = 20;
  const bx = 5, by = 20, bw = w - 10, bh = h - 40;
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
  ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
  ctx.arcTo(bx, by + bh, bx, by, r);
  ctx.arcTo(bx, by, bx + bw, by, r);
  ctx.closePath();
  ctx.fillStyle = "rgba(7, 9, 13, 0.6)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color + "66"; // 6-digit hex + alpha
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return { tex, aspect: w / h };
}

/** Additive rim-glow (fresnel) shader — the holo look for atmospheres, zone
 *  bubbles, and spawn shells. Brightens toward the silhouette edge. */
function fresnelMaterial(color: number, power = 2.4, intensity = 1.2): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uPower: { value: power },
      uIntensity: { value: intensity },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uPower; uniform float uIntensity;
      varying vec3 vN; varying vec3 vView;
      void main() {
        float rim = pow(1.0 - max(dot(vN, vView), 0.0), uPower);
        gl_FragColor = vec4(uColor * rim * uIntensity, rim);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function makeLabel(text: string, color: string): THREE.Sprite {
  const { tex, aspect } = drawLabelTexture(text, color);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  const H = 0.16;
  sprite.scale.set(aspect * H, H, 1);
  sprite.userData.aspect = aspect;
  return sprite;
}

/** Re-render an existing label sprite's text (used by the live measure label). */
function setLabelText(sprite: THREE.Sprite, text: string, color: string) {
  const { tex, aspect } = drawLabelTexture(text, color);
  const mat = sprite.material as THREE.SpriteMaterial;
  mat.map?.dispose();
  mat.map = tex;
  sprite.userData.aspect = aspect;
}

export function MapView({
  store,
  poiStore,
  playerPos,
  mobStore,
  presence,
  compact = false,
}: {
  store: ReturnType<typeof useAsteroids>;
  poiStore: ReturnType<typeof usePois>;
  playerPos: PlayerPos | null;
  /** Logged mob encounters — plotted as spawn points + wrapped in a sphere. */
  mobStore?: ReturnType<typeof useEncounters>;
  /** Live clan teammates (broadcasting), plotted as blue markers. */
  presence?: ClanLocation[];
  /** Radar mode: chrome hidden, camera follows the player. */
  compact?: boolean;
}) {
  // Merge static HM context + editable POIs + logged rocks + mob spawns, then
  // thin the belt: C/F/S asteroids inside the PVP sphere are dropped (they're
  // noise inside the zone) while ND and anything outside the sphere is kept.
  const pois = useMemo<MapPoi[]>(() => {
    const all = combinePois(store.items, poiStore.items, mobStore?.items ?? []);
    const anchors = all.filter(isBareM);
    if (anchors.length < 2) return all;
    const cx = anchors.reduce((s, p) => s + p.euX, 0) / anchors.length;
    const cy = anchors.reduce((s, p) => s + p.euY, 0) / anchors.length;
    const cz = anchors.reduce((s, p) => s + p.euZ, 0) / anchors.length;
    const r = Math.max(...anchors.map((p) => Math.hypot(p.euX - cx, p.euY - cy, p.euZ - cz)));
    const HIDE = new Set(["asteroid-c", "asteroid-f", "asteroid-s"]);
    return all.filter((p) => {
      if (!HIDE.has(p.category)) return true;
      return Math.hypot(p.euX - cx, p.euY - cy, p.euZ - cz) > r; // keep only if outside the sphere
    });
  }, [store.items, poiStore.items, mobStore?.items]);

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of pois) {
      const g = filterGroupOf(p);
      c[g] = (c[g] ?? 0) + 1;
    }
    return c;
  }, [pois]);
  const toggle = (k: string) =>
    setHidden((h) => {
      const n = new Set(h);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const [selected, setSelected] = useState<MapPoi | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [wpChip, setWpChip] = useState<string | null>(null);
  const [radarFilters, setRadarFilters] = useState(false);
  // Full map: the fat left panel is retired for a floating toolbar whose buttons
  // open focused modals.
  const [modal, setModal] = useState<null | "settings" | "pois">(null);
  const [coordsCopied, setCoordsCopied] = useState(false);
  // Per-machine label size (persisted). A ref feeds the render loop so the
  // slider updates live without rebuilding the scene.
  const [labelSize, setLabelSize] = useState<number>(() => {
    const v = Number(localStorage.getItem(LABEL_STORE_KEY));
    return v >= LABEL_SIZE_MIN && v <= LABEL_SIZE_MAX ? v : LABEL_SIZE_DEFAULT;
  });
  const labelSizeRef = useRef(labelSize);
  labelSizeRef.current = labelSize;
  const [markerScale, setMarkerScale] = useState<number>(() => {
    const v = Number(localStorage.getItem(MARKER_STORE_KEY));
    return v >= MARKER_SCALE_MIN && v <= MARKER_SCALE_MAX ? v : MARKER_SCALE_DEFAULT;
  });
  const markerScaleRef = useRef(markerScale);
  markerScaleRef.current = markerScale;
  const mountRef = useRef<HTMLDivElement>(null);
  // Last plotted player position (three-space), for the heading arrow.
  const lastPlayerRef = useRef<THREE.Vector3 | null>(null);
  // Live clan teammate markers, keyed by pilot id, reconciled against `presence`.
  const clanRef = useRef<Map<string, THREE.Group>>(new Map());
  const sceneRef = useRef<{
    scene: THREE.Scene;
    labels: THREE.Sprite[];
    meshes: Map<string, THREE.Object3D[]>;
    pickable: THREE.Mesh[];
    player: THREE.Group;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    center: { x: number; y: number; z: number };
    scale: number;
    measureLine: THREE.Line;
    measureLabel: THREE.Sprite;
    dispose: () => void;
  } | null>(null);

  // Build the scene whenever the POI set changes.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !pois.length) return;

    // Fit the scene to the belt only — the far-flung planet stations / warp
    // gates would otherwise compress everything into a clump. They still plot
    // at their true positions (far out) using this scale.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const FAR = new Set(["space-station", "warp-gate", "landmark"]);
    for (const p of pois) {
      if (FAR.has(p.category)) continue;
      minX = Math.min(minX, p.euX); maxX = Math.max(maxX, p.euX);
      minY = Math.min(minY, p.euY); maxY = Math.max(maxY, p.euY);
      minZ = Math.min(minZ, p.euZ); maxZ = Math.max(maxZ, p.euZ);
    }
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
    const scale = 8 / Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1000);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    // Direct rendering (no composer) keeps MSAA, so edges stay smooth; allow up
    // to 2× on high-DPI for crispness — cheap now that bloom is gone.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setClearColor(0x06070b, 1);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0x8899bb, 1.1));

    // Starfield
    const starGeo = new THREE.BufferGeometry();
    const stars = new Float32Array(2500 * 3);
    for (let i = 0; i < stars.length; i++) stars[i] = (Math.random() - 0.5) * 120;
    starGeo.setAttribute("position", new THREE.BufferAttribute(stars, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 0.05, color: 0x8fa0c0, transparent: true, opacity: 0.5 })));

    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.01, 500);
    camera.position.set(0, 6, 9);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1;
    controls.maxDistance = 60;

    // Radar: start top-down 2D, but keep orbit + pan so it can tilt into 3D.
    if (compact) {
      camera.position.set(0, 2.4, 0.001);
      controls.minDistance = 0.5;
      controls.maxDistance = 12;
    }

    const meshes = new Map<string, THREE.Object3D[]>();
    const pickable: THREE.Mesh[] = [];
    const pvpZonePos: THREE.Vector3[] = [];
    // EU position (for clustering) + three-space position (for drawing) per mob.
    const mobPts: { eu: THREE.Vector3; three: THREE.Vector3 }[] = [];
    // Labels kept at a constant on-screen size so far POIs stay readable.
    const labels: THREE.Sprite[] = [];
    // Objects that idly rotate (gates spin in-plane, stations tumble).
    const spinners: { o: THREE.Object3D; ax: "y" | "z"; sp: number }[] = [];

    // 4×3 sector reference grid on the belt's ecliptic plane. Lines + PvP-cell
    // fills + B2…E4 cell labels, all placed by absolute EU so they line up with
    // the POIs (crossing a cell seam in-game = entering PvP).
    {
      const floorZ = center.z;
      const gp = (ex: number, ey: number) => euToThree(ex, ey, floorZ, center, scale);
      const spanY = GRID_ROWS * GRID_CELL_EU;
      const spanX = GRID_COLS * GRID_CELL_EU;

      // Interior division lines only — no outer perimeter (crossing a seam = PvP).
      const linePts: THREE.Vector3[] = [];
      for (let c = 1; c < GRID_COLS; c++) {
        const ex = GRID_ORIGIN_EU.x + c * GRID_CELL_EU;
        linePts.push(gp(ex, GRID_ORIGIN_EU.y), gp(ex, GRID_ORIGIN_EU.y + spanY));
      }
      for (let r = 1; r < GRID_ROWS; r++) {
        const ey = GRID_ORIGIN_EU.y + r * GRID_CELL_EU;
        linePts.push(gp(GRID_ORIGIN_EU.x, ey), gp(GRID_ORIGIN_EU.x + spanX, ey));
      }
      const gridLines = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(linePts),
        new THREE.LineBasicMaterial({ color: 0x2b3a55, transparent: true, opacity: 0.45, depthWrite: false }),
      );
      gridLines.matrixAutoUpdate = false;
      scene.add(gridLines);

      // Cell labels (B2…E4); PvP cells tinted red.
      for (let c = 0; c < GRID_COLS; c++) {
        for (let r = 0; r < GRID_ROWS; r++) {
          const ex0 = GRID_ORIGIN_EU.x + c * GRID_CELL_EU;
          const ey0 = GRID_ORIGIN_EU.y + r * GRID_CELL_EU;
          const pvp = GRID_PVP_CELLS.some(([pc, pr]) => pc === c && pr === r);
          const lbl = makeLabel(GRID_COL_LETTERS[c] + GRID_ROW_NUMS[r], pvp ? "#ff5566" : "#4a6a90");
          lbl.position.copy(gp(ex0 + GRID_CELL_EU / 2, ey0 + GRID_CELL_EU / 2));
          lbl.userData.isLabel = true;
          scene.add(lbl);
          labels.push(lbl);
        }
      }
    }


    for (const p of pois) {
      const pos = euToThree(p.euX, p.euY, p.euZ, center, scale);
      const bare = isBareM(p);
      // "station" folds into space-station (only category kept).
      const spacest = p.category === "space-station" || p.category === "station";
      const gate = p.category === "warp-gate";
      const zone = p.category === "outlaw-zone";
      const color = bare ? M_BARE : CAT_COLOR[p.category] ?? 0x888888;
      const radius = MARKER_BASE;

      let mesh: THREE.Mesh;
      if (gate) {
        // Warp gate — glowing neon ring, spinning in-plane. 3× the belt markers.
        mesh = new THREE.Mesh(
          new THREE.TorusGeometry(radius * 3.45, radius * 0.78, 12, 40),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
        );
        spinners.push({ o: mesh, ax: "z", sp: 0.8 });
      } else if (spacest) {
        // Space station — dim core wrapped in a fresnel halo. 3× the belt markers.
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(radius * 3.15, 24, 24),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.32) }),
        );
        mesh.add(new THREE.Mesh(new THREE.SphereGeometry(radius * 4.65, 28, 28), fresnelMaterial(color, 2.2, 1.5)));
      } else if (zone) {
        // Outlaw-zone marker — hazard octahedron, additive glow.
        mesh = new THREE.Mesh(
          new THREE.OctahedronGeometry(radius * 1.15),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
        );
        spinners.push({ o: mesh, ax: "y", sp: 0.6 });
      } else if (p.category === "player") {
        // Logged player / hostile — rose diamond, stands out from the rock dots.
        mesh = new THREE.Mesh(new THREE.OctahedronGeometry(radius * 1.1), new THREE.MeshBasicMaterial({ color }));
      } else {
        // Asteroid / anchor — glowing point; context rocks dimmed so bloom and
        // the eye favour the key POIs.
        const c = new THREE.Color(color);
        if (!p.logged) c.multiplyScalar(bare ? 0.8 : 0.92);
        mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 8), new THREE.MeshBasicMaterial({ color: c }));
      }
      mesh.position.copy(pos);
      mesh.scale.setScalar(markerScaleRef.current);
      mesh.userData.poiId = p.id;
      // Static markers (everything but the spinning gates/zones) skip the
      // per-frame matrix recompute — a big CPU win across the whole belt.
      if (!(gate || zone)) {
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
      }
      scene.add(mesh);
      pickable.push(mesh);
      const objs: THREE.Object3D[] = [mesh];

      const label = labelFor(p);
      if (label) {
        const spr = makeLabel(label, "#" + new THREE.Color(color).getHexString());
        spr.position.copy(pos);
        spr.position.y += spacest ? 0.3 : 0.18;
        spr.userData.poiId = p.id;
        spr.userData.isLabel = true;
        scene.add(spr);
        objs.push(spr);
        labels.push(spr);
      }
      // The PVP zone hugs the bare-M anchor field (the belt skeleton).
      if (bare) pvpZonePos.push(pos);
      if (p.category === "mob")
        mobPts.push({ eu: new THREE.Vector3(p.euX, p.euY, p.euZ), three: pos.clone() });
      meshes.set(p.id, objs);
    }

    // PVP-zone sphere fitted around the anchor rocks.
    if (pvpZonePos.length) {
      const c = pvpZonePos.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / pvpZonePos.length);
      const r = Math.max(...pvpZonePos.map((v) => v.distanceTo(c))) + 0.1;
      const zoneMesh = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 32), fresnelMaterial(0xef4444, 3.0, 0.9));
      zoneMesh.position.copy(c);
      scene.add(zoneMesh);
    }

    // Mob spawn spheres — cluster logged mobs by proximity (single-link in EU
    // space) so each distinct spawn area gets its own sphere, spanning that
    // cluster's two farthest points, rather than one sphere stretched across
    // sectors.
    if (mobPts.length) {
      const n = mobPts.length;
      const parent = Array.from({ length: n }, (_, i) => i);
      const find = (i: number): number => {
        while (parent[i] !== i) {
          parent[i] = parent[parent[i]];
          i = parent[i];
        }
        return i;
      };
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (mobPts[i].eu.distanceTo(mobPts[j].eu) <= MOB_CLUSTER_EU) {
            parent[find(i)] = find(j);
          }
        }
      }
      const clusters = new Map<number, THREE.Vector3[]>();
      for (let i = 0; i < n; i++) {
        const r = find(i);
        let arr = clusters.get(r);
        if (!arr) {
          arr = [];
          clusters.set(r, arr);
        }
        arr.push(mobPts[i].three);
      }

      const mobColor = 0xf2683c;
      for (const pts of clusters.values()) {
        // Farthest pair → sphere centre + radius (lone points get a small bubble).
        let a = pts[0];
        let b = pts[0];
        let maxD = -1;
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < pts.length; j++) {
            const d2 = pts[i].distanceToSquared(pts[j]);
            if (d2 > maxD) {
              maxD = d2;
              a = pts[i];
              b = pts[j];
            }
          }
        }
        const centre = a.clone().add(b).multiplyScalar(0.5);
        const radius = Math.max(a.distanceTo(b) / 2, 0.06);
        const spawn = new THREE.Mesh(
          new THREE.SphereGeometry(radius, 32, 32),
          fresnelMaterial(mobColor, 2.8, 1.0),
        );
        spawn.position.copy(centre);
        scene.add(spawn);
      }
    }

    // Player marker — a gold arrow that yaws to the heading of travel. The whole
    // group is rotated about Y by the position effect; the arrowhead points +Z.
    const playerGroup = new THREE.Group();
    const pColor = 0xffd54a;
    const arrowGeo = new THREE.ConeGeometry(0.055, 0.15, 4);
    arrowGeo.rotateX(Math.PI / 2); // apex → +Z (the heading direction)
    const arrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: pColor }));
    const pLabel = makeLabel("YOU", "#ffd54a");
    pLabel.position.y = 0.15;
    pLabel.userData.isLabel = true;
    labels.push(pLabel);
    playerGroup.add(arrow, pLabel);
    playerGroup.visible = false;
    scene.add(playerGroup);

    // Click-to-measure range line (player → clicked POI); drawn on top.
    const measureLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.85, depthTest: false }),
    );
    measureLine.visible = false;
    measureLine.renderOrder = 999;
    scene.add(measureLine);

    // Midpoint readout drawn on the range line (distance · ETA). Registered as a
    // label so it holds a constant on-screen size and honours the size slider.
    const measureLabel = makeLabel(" ", "#ffd54a");
    measureLabel.visible = false;
    measureLabel.renderOrder = 1000;
    measureLabel.userData.pinned = true;
    scene.add(measureLabel);
    labels.push(measureLabel);

    // Interaction
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    // Fly the camera to a POI, keeping the current viewing angle.
    const focusTo = (mp: MapPoi) => {
      const target = euToThree(mp.euX, mp.euY, mp.euZ, center, scale);
      const dir = camera.position.clone().sub(controls.target);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0.001);
      dir.normalize();
      controls.target.copy(target);
      camera.position.copy(target).add(dir.multiplyScalar(compact ? 1.8 : 2.5));
      controls.update();
    };
    const onClick = (e: MouseEvent) => {
      if ((e.clientX - down.x) ** 2 + (e.clientY - down.y) ** 2 > 25) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      // Clicking a POI (its label sits on top, so test labels first, else the
      // marker) focuses it and kicks off the measure flow via `selected`.
      const labelHit = raycaster.intersectObjects(labels).find((h) => h.object.userData.poiId);
      const dotHit = raycaster.intersectObjects(pickable)[0];
      const id = (labelHit?.object.userData.poiId ?? dotHit?.object.userData.poiId) as
        | string
        | undefined;
      if (id) {
        const mp = pois.find((p) => p.id === id);
        if (mp) {
          focusTo(mp);
          setSelected(mp);
        }
      } else setSelected(null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("click", onClick);

    let raf = 0;
    const start = performance.now();
    let prev = start;
    const tmpV = new THREE.Vector3();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min((now - prev) / 1000, 0.05);
      prev = now;
      controls.update();
      for (const sp of spinners) sp.o.rotation[sp.ax] += sp.sp * dt;
      if (playerGroup.visible) {
        const t = (now - start) / 1000;
        arrow.scale.setScalar(1 + Math.sin(t * 3) * 0.1);
      }

      // Labels: hold a constant on-screen size at every zoom (distance × factor
      // cancels perspective). No overlap culling — labels stay put (no flicker).
      for (const lb of labels) {
        if (lb.parent === playerGroup && !playerGroup.visible) continue;
        if (!lb.userData.pinned) lb.visible = !lb.userData.filteredHidden;
        if (!lb.visible) continue;
        lb.getWorldPosition(tmpV);
        const s = Math.max(camera.position.distanceTo(tmpV) * labelSizeRef.current, 0.01);
        const a = (lb.userData.aspect as number) ?? 3;
        lb.scale.set(a * s, s, 1);
      }

      renderer.render(scene, camera);
    };
    loop();

    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    // Fresh scene → drop any teammate markers from the previous one; the
    // presence effect re-adds them against this scene.
    clanRef.current.clear();

    sceneRef.current = {
      scene,
      labels,
      meshes,
      pickable,
      player: playerGroup,
      camera,
      controls,
      center,
      scale,
      measureLine,
      measureLabel,
      dispose: () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        renderer.domElement.removeEventListener("pointerdown", onDown);
        renderer.domElement.removeEventListener("click", onClick);
        controls.dispose();
        renderer.dispose();
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      },
    };
    return () => sceneRef.current?.dispose();
  }, [pois]);

  // Place the "YOU" marker at the freshly captured position (falling back to the
  // last watcher position) and, when measuring, draw the range line to the POI.
  useEffect(() => {
    const d = sceneRef.current;
    if (!d) return;
    const eff = playerPos ? { x: playerPos.x, y: playerPos.y, z: playerPos.z } : null;
    if (!eff) {
      d.player.visible = false;
      d.measureLine.visible = false;
      d.measureLabel.visible = false;
      return;
    }
    const tgt = euToThree(eff.x, eff.y, eff.z, d.center, d.scale);
    // Yaw the arrow to the heading of travel (game horizontal plane = three XZ).
    const last = lastPlayerRef.current;
    if (last) {
      const dx = tgt.x - last.x;
      const dz = tgt.z - last.z;
      if (dx * dx + dz * dz > 1e-8) d.player.rotation.y = Math.atan2(dx, dz);
    }
    lastPlayerRef.current = tgt.clone();
    d.player.position.copy(tgt);
    d.player.visible = true;
    // Radar: follow the player by panning (translate camera + target by the same
    // delta) — but NOT while measuring, so the camera stays on the clicked POI.
    if (compact && !selected) {
      const delta = tgt.clone().sub(d.controls.target);
      d.camera.position.add(delta);
      d.controls.target.add(delta);
      d.controls.update();
    }
    // Range line from YOU to the selected POI, with a distance · ETA readout
    // drawn at its midpoint. Uses the effective position, so it appears at once
    // (from the last-known spot) and refines when the `<` capture lands.
    if (selected) {
      const to = euToThree(selected.euX, selected.euY, selected.euZ, d.center, d.scale);
      d.measureLine.geometry.setFromPoints([tgt.clone(), to]);
      d.measureLine.visible = true;
      const raw = Math.hypot(selected.euX - eff.x, selected.euY - eff.y, selected.euZ - eff.z);
      const au = raw / EU_PER_AU;
      setLabelText(d.measureLabel, `${fmtDist(raw)} · ~${fmtEta(etaSeconds(au))}`, "#ffd54a");
      const mid = tgt.clone().add(to).multiplyScalar(0.5);
      mid.y += 0.05;
      d.measureLabel.position.copy(mid);
      d.measureLabel.visible = true;
    } else {
      d.measureLine.visible = false;
      d.measureLabel.visible = false;
    }
  }, [playerPos, selected, pois, compact]);

  // Live clan teammates — reconcile a blue marker + name label per broadcasting
  // pilot against `presence`. Markers hook into the scene's label array so they
  // hold constant on-screen size like every other label.
  useEffect(() => {
    const d = sceneRef.current;
    if (!d) return;
    const CLAN = 0x49b3ff;
    const seen = new Set<string>();

    for (const loc of presence ?? []) {
      if (!Number.isFinite(loc.x) || !Number.isFinite(loc.y) || !Number.isFinite(loc.z)) continue;
      seen.add(loc.pilot_id);
      const pos = euToThree(loc.x, loc.y, loc.z, d.center, d.scale);
      let group = clanRef.current.get(loc.pilot_id);
      if (!group) {
        group = new THREE.Group();
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 16, 16),
          new THREE.MeshBasicMaterial({ color: CLAN }),
        );
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.12, 0.014, 8, 32),
          new THREE.MeshBasicMaterial({ color: CLAN, transparent: true, opacity: 0.65 }),
        );
        ring.rotation.x = Math.PI / 2;
        const label = makeLabel(loc.pilot ?? "pilot", "#8fd3ff");
        label.position.y = 0.2;
        label.userData.name = loc.pilot;
        group.add(dot, ring, label);
        group.userData.label = label;
        d.scene.add(group);
        d.labels.push(label);
        clanRef.current.set(loc.pilot_id, group);
      } else {
        const label = group.userData.label as THREE.Sprite;
        if (label.userData.name !== loc.pilot) {
          setLabelText(label, loc.pilot ?? "pilot", "#8fd3ff");
          label.userData.name = loc.pilot;
        }
      }
      group.position.copy(pos);
    }

    // Drop teammates no longer broadcasting.
    for (const [id, group] of clanRef.current) {
      if (seen.has(id)) continue;
      d.scene.remove(group);
      const label = group.userData.label as THREE.Sprite;
      const i = d.labels.indexOf(label);
      if (i >= 0) d.labels.splice(i, 1);
      const lm = label.material as THREE.SpriteMaterial;
      lm.map?.dispose();
      lm.dispose();
      group.children.forEach((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      clanRef.current.delete(id);
    }
  }, [presence, pois]);

  // Mini-map (compact) has no detail panel — clicking a POI copies its EU
  // waypoint straight to the clipboard and flashes a confirmation chip.
  useEffect(() => {
    if (!compact || !selected) return;
    const wp = `/wp [Space, ${selected.euX}, ${selected.euY}, ${selected.euZ}, ${selected.name}]`;
    navigator.clipboard.writeText(wp).catch(() => {});
    setWpChip(selected.name);
    const t = setTimeout(() => setWpChip(null), 1800);
    return () => clearTimeout(t);
  }, [selected, compact]);

  // Persist the label size, and pick up changes made from another window
  // (e.g. the main map) so the radar honours the same preference.
  useEffect(() => {
    localStorage.setItem(LABEL_STORE_KEY, String(labelSize));
  }, [labelSize]);

  // Persist marker scale and rescale every marker live as the slider moves.
  useEffect(() => {
    localStorage.setItem(MARKER_STORE_KEY, String(markerScale));
    sceneRef.current?.pickable.forEach((m) => {
      m.scale.setScalar(markerScale);
      m.updateMatrix(); // static markers have matrixAutoUpdate off
    });
  }, [markerScale]);
  useEffect(() => {
    const h = (e: StorageEvent) => {
      if (e.key !== LABEL_STORE_KEY || !e.newValue) return;
      const v = Number(e.newValue);
      if (v >= LABEL_SIZE_MIN && v <= LABEL_SIZE_MAX) setLabelSize(v);
    };
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);

  // Visibility = type-filter toggles.
  useEffect(() => {
    const data = sceneRef.current;
    if (!data) return;
    for (const p of pois) {
      const visible = !hidden.has(filterGroupOf(p));
      data.meshes.get(p.id)?.forEach((o) => {
        // Labels are owned by the render loop's collision pass — flag them here
        // rather than forcing visibility, so filtering + culling don't fight.
        if (o.userData.isLabel) o.userData.filteredHidden = !visible;
        else o.visible = visible;
      });
    }
  }, [pois, hidden]);

  const loggedCount = store.items.length;

  // Fly the map camera to a POI (keeping the current view angle) and open it.
  const focusPoi = (poi: Poi) => {
    const d = sceneRef.current;
    if (!d) return;
    const p = euToThree(poi.eu_x, poi.eu_y, poi.eu_z, d.center, d.scale);
    const dir = d.camera.position.clone().sub(d.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 1);
    dir.normalize();
    d.controls.target.copy(p);
    d.camera.position.copy(p).add(dir.multiplyScalar(2.5));
    d.controls.update();
    setSelected(pois.find((mp) => mp.id === poi.id) ?? null);
  };

  // Live player coords for the minimap readout (last-known watcher position).
  const coords = playerPos ? { x: playerPos.x, y: playerPos.y, z: playerPos.z } : null;
  const copyCoords = () => {
    if (!coords) return;
    navigator.clipboard
      .writeText(`/wp [Space, ${coords.x}, ${coords.y}, ${coords.z}, You]`)
      .then(() => {
        setCoordsCopied(true);
        setTimeout(() => setCoordsCopied(false), 1200);
      })
      .catch(() => {});
  };

  // Recentre the radar on the player, resetting to a clean top-down view.
  const focusPlayer = () => {
    const d = sceneRef.current;
    if (!d || !playerPos) return;
    const tgt = euToThree(playerPos.x, playerPos.y, playerPos.z, d.center, d.scale);
    d.controls.target.copy(tgt);
    d.camera.up.set(0, 1, 0);
    d.camera.position.set(tgt.x, tgt.y + 2.4, tgt.z + 0.001);
    d.controls.update();
  };

  // Expand → near-fullscreen (leaving a margin so the window border frames it);
  // minify → back to the compact card pinned to the monitor's top-right.
  const toggleSize = async () => {
    const next = !expanded;
    try {
      const win = getCurrentWindow();
      const mon = await currentMonitor();
      if (!mon) return;
      const sf = await win.scaleFactor();
      const margin = Math.round(28 * sf);
      if (next) {
        await win.setPosition(
          new PhysicalPosition(mon.position.x + margin, mon.position.y + margin),
        );
        await win.setSize(
          new PhysicalSize(mon.size.width - margin * 2, mon.size.height - margin * 2),
        );
      } else {
        const w = Math.round(300 * sf);
        const h = Math.round(336 * sf);
        await win.setSize(new PhysicalSize(w, h));
        await win.setPosition(
          new PhysicalPosition(
            mon.position.x + mon.size.width - w - margin,
            mon.position.y + margin,
          ),
        );
      }
      setExpanded(next);
    } catch {
      /* window resize unavailable */
    }
  };

  const filterGroups = FILTERS.filter((g) => counts[g.key]);

  return (
    <div className="map">
      <div className="map__view">
      <div ref={mountRef} className="map__canvas" />

      {compact ? (
        <>
          <div className="radartl">
            <button
              className="radarcoords"
              onClick={copyCoords}
              disabled={!coords}
              title="Copy waypoint"
            >
              ⌖ {coords ? `${coords.x}, ${coords.y}, ${coords.z}` : "no fix"}
              {coordsCopied ? " ✓" : ""}
            </button>
          </div>

          <button
            className={`radarfilter ${radarFilters ? "radarfilter--on" : ""}`}
            onClick={() => setRadarFilters((f) => !f)}
            title="Filters"
            aria-label="Filters"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 5h18l-7 8v6l-4-2v-4Z" />
            </svg>
          </button>
          {radarFilters && (
            <div className="radarfilters">
              {filterGroups.map((g) => (
                <button
                  key={g.key}
                  className={`legrow ${hidden.has(g.key) ? "legrow--off" : ""}`}
                  onClick={() => toggle(g.key)}
                >
                  <span className="legrow__sw" style={{ background: g.color }} />
                  <span className="legrow__label">{g.label}</span>
                  <span className="legrow__count">{counts[g.key]}</span>
                </button>
              ))}
            </div>
          )}
          {wpChip && (
            <div className="radarwp" role="status">
              🛰 {wpChip} · WP copied
            </div>
          )}
          <button
            className="radarexp"
            onClick={toggleSize}
            title={expanded ? "Minify map" : "Expand map"}
            aria-label={expanded ? "Minify map" : "Expand map"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {expanded ? (
                <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
              ) : (
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              )}
            </svg>
          </button>
          <button
            className="radarfocus"
            onClick={focusPlayer}
            title="Focus on player"
            aria-label="Focus on player"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="7" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
              <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </>
      ) : (
        <>
          <div className="maptools">
            <div className="maptools__stats">
              <span className="mtchip">
                <b>{pois.filter(isBareM).length}</b> belt
              </span>
              <span className="mtchip">
                <b>{loggedCount}</b> logged
              </span>
              <span className="mtchip mtchip--outlaw">
                <b>{pois.filter((p) => p.category === "outlaw-zone").length}</b> outlaw
              </span>
            </div>
            <button
              className={`maptool ${modal === "settings" ? "maptool--on" : ""}`}
              onClick={() => setModal(modal === "settings" ? null : "settings")}
              title="View settings"
              aria-label="View settings"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8h10M18 8h2M4 16h6M14 16h6" />
                <circle cx="16" cy="8" r="2.2" fill="currentColor" stroke="none" />
                <circle cx="10" cy="16" r="2.2" fill="currentColor" stroke="none" />
              </svg>
            </button>
            <button
              className={`maptool ${modal === "pois" ? "maptool--on" : ""}`}
              onClick={() => setModal(modal === "pois" ? null : "pois")}
              title="POIs"
              aria-label="POIs"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
            </button>
          </div>

          <MapDetail poi={selected} onClose={() => setSelected(null)} onDelete={store.remove} />

          <div className="mapfilters">
            <div className="mapfilters__head">
              <span className="mapfilters__title">Filters</span>
              <button className="mapfilters__act" onClick={() => setHidden(new Set())}>
                All
              </button>
              <button
                className="mapfilters__act"
                onClick={() => setHidden(new Set(FILTERS.map((f) => f.key)))}
              >
                None
              </button>
            </div>
            {FILTERS.map((g) => (
              <button
                key={g.key}
                className={`legrow ${hidden.has(g.key) ? "legrow--off" : ""}`}
                onClick={() => toggle(g.key)}
              >
                <span className="legrow__sw" style={{ background: g.color }} />
                <span className="legrow__label">{g.label}</span>
                <span className="legrow__count">{counts[g.key] ?? 0}</span>
              </button>
            ))}
          </div>

          {modal === "settings" && (
            <MapModal title="View" onClose={() => setModal(null)}>
              <div className="mapset">
                <div className="mappanel__lbl">
                  Markers <span className="mappanel__val">{Math.round(markerScale * 100)}%</span>
                </div>
                <input
                  type="range"
                  className="mapslider"
                  min={Math.round(MARKER_SCALE_MIN * 100)}
                  max={Math.round(MARKER_SCALE_MAX * 100)}
                  value={Math.round(markerScale * 100)}
                  aria-label="Marker size"
                  onChange={(e) => setMarkerScale(Number(e.target.value) / 100)}
                />
                <div className="mappanel__lbl mappanel__lbl--sub">
                  Labels <span className="mappanel__val">{Math.round((labelSize / LABEL_SIZE_DEFAULT) * 100)}%</span>
                </div>
                <input
                  type="range"
                  className="mapslider"
                  min={Math.round(LABEL_SIZE_MIN * 1000)}
                  max={Math.round(LABEL_SIZE_MAX * 1000)}
                  value={Math.round(labelSize * 1000)}
                  aria-label="Label size"
                  onChange={(e) => setLabelSize(Number(e.target.value) / 1000)}
                />
              </div>
            </MapModal>
          )}

          {modal === "pois" && (
            <MapModal title="POIs" onClose={() => setModal(null)} wide>
              <PoiEditor poiStore={poiStore} onFocus={focusPoi} />
            </MapModal>
          )}
        </>
      )}
      </div>
    </div>
  );
}

/** A lightweight modal used by the map's toolbar buttons. */
function MapModal({
  title,
  onClose,
  wide,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  // Portalled to <body> so no ancestor's transform/overflow/stacking context can
  // trap or clip it (which is what broke the editor modal before).
  return createPortal(
    <div className="mapmodal" onClick={onClose}>
      <div
        className={`mapmodal__box ${wide ? "mapmodal__box--wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mapmodal__bar">
          <span className="mapmodal__title">{title}</span>
          <button className="mapmodal__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="mapmodal__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
