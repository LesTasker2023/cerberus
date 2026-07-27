import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import type { useEncounters } from "../hooks/useEncounters";
import type { usePois, Poi } from "../hooks/usePois";
import type { PlayerPos } from "../hooks/usePlayerPosition";
import type { ClanLocation } from "../lib/locations";
import { combinePois, type MapPoi } from "../lib/pois";
import { PoiEditor } from "../components/PoiEditor";
import { SectorCard } from "../components/SectorCard";

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
/** Belt-anchor skeleton. Neutral grey rather than the steel-blue it used to be:
 *  that sat right next to `asteroid-m`'s blue, so the belt scaffolding and real
 *  M-type rocks read as the same thing. Grey also lets it recede, which is what
 *  scaffolding should do. Rendered ×0.8 (see the draw loop), so it lands darker
 *  than `asteroid-scrap` and stays distinct from that too. */
const M_BARE = 0x767c86;

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
  // Swatch follows asteroid-m, the dominant type — it used to be the anchor
  // colour, which is now grey and no longer represents the group.
  { key: "asteroid", label: "Asteroids", color: "#3f7fff" },
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
/** Sector name cap-height as a fraction of its cell — so every sector's name
 *  renders at the same size regardless of how long it is. */
const SECTOR_LABEL_HEIGHT = 0.13;
/** Resting opacity of the painted sector names — floor markings, not UI. */
const SECTOR_LABEL_OPACITY = 0.42;
/**
 * How far the sector name sits from its cell's low-Y edge, as a fraction of the
 * cell. Captioning the edge rather than stamping the middle keeps the name clear
 * of the markers, which cluster centrally — and it reads like a map legend
 * rather than a watermark. Far enough in to clear the seam glow.
 */
const SECTOR_LABEL_EDGE = 0.11;

/**
 * A sector takes its name from the space station sitting in it — Calypso,
 * Arkadia, ROCKtropia and so on — rather than its grid reference, since that's
 * what anyone actually calls the place. Derived from the POI store at scene
 * build, so a station added later names its own sector with no code change.
 *
 * Cells holding several stations use the one nearest the cell centre, which is
 * what picks Calypso out of Aris/Calypso/Setesh in B3. Add an entry to
 * SECTOR_NAME_OVERRIDES when that heuristic gets it wrong.
 */
const SECTOR_NAME_OVERRIDES: Record<string, string> = {
  // Neither of these can be derived, and both contradict where the matching
  // POIs currently sit: there is no Cyrene station at all (only a warp gate,
  // logged in C2), and the Zeus station's coordinates put it in C3 next to
  // Erebos. Names confirmed by Les, so they win — but if those two POI
  // coordinates are simply wrong, fixing them is the better repair and these
  // entries can then go.
  B2: "Cyrene",
  C2: "Zeus",
  // The station POI is "Toulan"; the sector goes by Poolan.
  E4: "Poolan",
};
/** [col, row] of the PvP grid cells — C2, C3, D3, E2. */
const GRID_PVP_CELLS: [number, number][] = [[1, 0], [1, 1], [2, 1], [3, 0]];

/** The hazard red shared by the PVP sphere and the sector seams. Both mark the
 *  same thing — the boundary you don't want to cross by accident — so they're
 *  one constant rather than two colours that can drift apart. */
const PVP_COLOR = 0xef4444;
/** Glow width of a sector seam, as a fraction of one grid cell. Raise for a
 *  fatter halo, drop for a tighter line. */
const GRID_GLOW_WIDTH = 0.045;
/**
 * Seam brightness. Kept well under 1 because a ribbon's core always faces the
 * camera at full strength, whereas the PVP sphere's fresnel only lights near its
 * silhouette — most of the ball reads dim. Matching the sphere means matching
 * that body brightness, not its rim, or the seams turn into laser beams.
 */
const GRID_GLOW_INTENSITY = 0.34;
/** Wash over the four lootable-PVP cells. Additive on a dark field, so this goes
 *  a long way — it should suggest the hazard, not colour the map. */
const GRID_PVP_FILL_OPACITY = 0.055;

/**
 * Semantic zoom: how far from the camera a category's label survives, in world
 * units. This is the label budget — a navigation map should read as a handful of
 * destinations at rest, not thirty names at once, so only the things you'd
 * actually fly *to* are labelled from a distance. Everything else earns its name
 * as you approach it, or on hover.
 *
 * The belt spans roughly 8 units, and the camera orbits between 1 and 60.
 */
const LABEL_RANGE: Record<string, number> = {
  "space-station": Infinity, // destinations — always readable
  station: Infinity,
  "warp-gate": Infinity,
  "outlaw-zone": 26, // hazards you want to see before you're in them
  player: 20,
  mob: 16,
  landmark: 16,
};
/** Fallback for everything unlisted — mostly logged rocks, which are survey
 *  detail and only worth naming once you're among them. */
const LABEL_RANGE_DEFAULT = 7;

/**
 * Depth cue. Markers and labels fade with distance *relative to the point you're
 * orbiting*, not absolutely — an absolute fog would black out the whole belt the
 * moment you pulled back. `NEAR`/`FAR` are multiples of the camera-to-pivot
 * distance, so the effect holds at any zoom: things at your focal depth are
 * full strength, things well behind it recede.
 */
const DEPTH_NEAR = 0.75;
const DEPTH_FAR = 2.1;
/** How dark the farthest markers get. Not 0 — they should still register. */
const DEPTH_MIN = 0.22;
/** Labels fade harder than markers; distant text is noise, distant dots are context. */
const DEPTH_MIN_LABEL = 0.1;

/** Fade-in for markers revealed by focusing a sector. Kept short — this is
 *  feedback that the view changed, not an animation to sit through. */
const REVEAL_MS = 260;
/** Random per-marker delay so a sector blooms in rather than flashing on as one
 *  hard edge. Deterministic per marker (assigned once at creation). */
const REVEAL_STAGGER_MS = 140;

/**
 * Overview mode shows destinations only — the things you'd actually plot a
 * course to. Everything else (rocks, mobs, zones, players) is sector detail and
 * appears once you drill into a sector.
 */
const OVERVIEW_CATEGORIES = new Set(["space-station", "station", "warp-gate"]);

/** Cell reference like "C3" from column/row indices. */
const cellRef = (c: number, r: number) => GRID_COL_LETTERS[c] + GRID_ROW_NUMS[r];

/** Which grid cell an EU coordinate falls in, or null if outside the grid. */
function cellOfEu(x: number, y: number): { c: number; r: number } | null {
  const c = Math.floor((x - GRID_ORIGIN_EU.x) / GRID_CELL_EU);
  const r = Math.floor((y - GRID_ORIGIN_EU.y) / GRID_CELL_EU);
  if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) return null;
  return { c, r };
}
const cellOfPoi = (p: MapPoi) => cellOfEu(p.euX, p.euY);

/**
 * Resolve every cell to its sector name: an explicit override first, else the
 * station nearest the cell centre, else the grid reference. Shared by the floor
 * markings and the toolbar so the two can never disagree.
 */
function deriveSectorNames(pois: MapPoi[]): Map<string, string> {
  const stations = pois.filter(
    (p) => p.category === "space-station" || p.category === "station",
  );
  const out = new Map<string, string>();
  for (let c = 0; c < GRID_COLS; c++) {
    for (let r = 0; r < GRID_ROWS; r++) {
      const ref = cellRef(c, r);
      const ex0 = GRID_ORIGIN_EU.x + c * GRID_CELL_EU;
      const ey0 = GRID_ORIGIN_EU.y + r * GRID_CELL_EU;
      const cx = ex0 + GRID_CELL_EU / 2;
      const cy = ey0 + GRID_CELL_EU / 2;
      let best: { name: string; d: number } | null = null;
      for (const p of stations) {
        if (p.euX < ex0 || p.euX >= ex0 + GRID_CELL_EU) continue;
        if (p.euY < ey0 || p.euY >= ey0 + GRID_CELL_EU) continue;
        const d = Math.hypot(p.euX - cx, p.euY - cy);
        if (!best || d < best.d) best = { name: p.name, d };
      }
      out.set(ref, SECTOR_NAME_OVERRIDES[ref] ?? best?.name ?? ref);
    }
  }
  return out;
}

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

/** Pointer tolerance for picking a marker, in screen pixels. Fitts's law: a
 *  fixed pixel target beats hit-testing geometry that shrinks with distance. */
const PICK_RADIUS_PX = 15;
/** How much the hovered marker grows, as confirmation of what you're aiming at. */
const HOVER_SCALE = 1.7;


/**
 * Render a label to a canvas texture.
 *
 * Default is bare text with a dark halo rather than a filled pill. Thirty pills
 * on screen is thirty opaque rectangles competing with the scene — the chrome
 * ends up louder than the names it carries. The halo buys the same legibility
 * over a bright field for none of the visual weight. `boxed` keeps the pill for
 * the few labels that should read as UI rather than as part of the scene.
 */
function drawLabelTexture(
  text: string,
  color: string,
  boxed = false,
): { tex: THREE.CanvasTexture; aspect: number } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = "600 60px 'IBM Plex Mono', monospace";
  ctx.font = font;
  const padX = boxed ? 32 : 18;
  const w = Math.ceil(ctx.measureText(text).width + padX * 2);
  const h = 96;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;

  if (boxed) {
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
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (!boxed) {
    // Dark halo: keeps the name readable against the belt without a filled box.
    ctx.lineWidth = 9;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(4, 6, 10, 0.92)";
    ctx.strokeText(text, w / 2, h / 2 + 1);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return { tex, aspect: w / h };
}

/**
 * Sector name as a texture for the floor markings. Unlike the POI labels these
 * aren't camera-facing sprites — they lie flat on the ecliptic and take the
 * scene's perspective, which is what keeps them reading as part of the space
 * rather than as another thing competing in the UI layer.
 */
function drawFloorText(
  text: string,
  color: string,
): { tex: THREE.CanvasTexture; aspect: number } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = "700 110px 'IBM Plex Mono', monospace";
  // Wide tracking is the cartographic convention for a region name, and it
  // reads better than a tight word when foreshortened by perspective.
  const track = "14px";
  const apply = () => {
    ctx.font = font;
    // Not in every engine; ignored where unsupported rather than throwing.
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = track;
  };
  apply();
  const padX = 40;
  const padY = 34;
  const w = Math.ceil(ctx.measureText(text).width + padX * 2);
  const h = 110 + padY * 2;
  canvas.width = w;
  canvas.height = h;
  apply(); // resizing the canvas resets the 2D context
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
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

/**
 * Neon-glow material for the sector seams — the line equivalent of the PVP
 * sphere's fresnel. That shader fades by surface normal against the view vector,
 * which a line can't supply, so the falloff is taken across the ribbon's width
 * instead: a hot core at the centreline easing out to nothing at the edges.
 * Same additive, depth-write-free treatment, so it reads as the same material.
 */
function glowRibbonMaterial(color: number, power = 2.2, intensity = 1.6): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uPower: { value: power },
      uIntensity: { value: intensity },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uPower; uniform float uIntensity;
      varying vec2 vUv;
      void main() {
        // 0 at the centreline, 1 at the ribbon edge.
        float d = abs(vUv.x * 2.0 - 1.0);
        float g = pow(1.0 - d, uPower);
        gl_FragColor = vec4(uColor * g * uIntensity, g);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Widen line segments into flat ribbons lying in the map's horizontal plane, so
 * `glowRibbonMaterial` has width to fade across. WebGL caps `linewidth` at 1, so
 * geometry is the only way to get a thick glowing line. All segments are merged
 * into one buffer — a mesh per seam would be a draw call per seam.
 *
 * `pts` is a flat list of segment endpoint pairs, as fed to `LineSegments`.
 */
function buildGlowRibbons(pts: THREE.Vector3[], width: number): THREE.BufferGeometry {
  const segs = Math.floor(pts.length / 2);
  const position = new Float32Array(segs * 4 * 3);
  const uv = new Float32Array(segs * 4 * 2);
  const index = new Uint32Array(segs * 6);
  const half = width / 2;

  for (let s = 0; s < segs; s++) {
    const a = pts[s * 2];
    const b = pts[s * 2 + 1];
    // Perpendicular within the horizontal plane (the grid is flat, y constant).
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const px = (-dz / len) * half;
    const pz = (dx / len) * half;

    const corners = [
      [a.x - px, a.y, a.z - pz, 0, 0],
      [a.x + px, a.y, a.z + pz, 1, 0],
      [b.x + px, b.y, b.z + pz, 1, 1],
      [b.x - px, b.y, b.z - pz, 0, 1],
    ];
    for (let c = 0; c < 4; c++) {
      const v = (s * 4 + c) * 3;
      position[v] = corners[c][0];
      position[v + 1] = corners[c][1];
      position[v + 2] = corners[c][2];
      const t = (s * 4 + c) * 2;
      uv[t] = corners[c][3];
      uv[t + 1] = corners[c][4];
    }
    const base = s * 4;
    const i = s * 6;
    index[i] = base;
    index[i + 1] = base + 1;
    index[i + 2] = base + 2;
    index[i + 3] = base;
    index[i + 4] = base + 2;
    index[i + 5] = base + 3;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  return geo;
}

function makeLabel(text: string, color: string, boxed = false): THREE.Sprite {
  const { tex, aspect } = drawLabelTexture(text, color, boxed);
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
  poiStore,
  playerPos,
  mobStore,
  presence,
  compact = false,
}: {
  poiStore: ReturnType<typeof usePois>;
  playerPos: PlayerPos | null;
  /** Logged mob encounters — plotted as spawn points + wrapped in a sphere. */
  mobStore?: ReturnType<typeof useEncounters>;
  /** Live clan teammates (broadcasting), plotted as blue markers. */
  presence?: ClanLocation[];
  /** Radar mode: chrome hidden, camera follows the player. */
  compact?: boolean;
}) {
  // Build markers from the one POI store + mob spawns, then thin the belt: C/F/S
  // asteroids inside the PVP sphere are dropped (they're noise inside the zone)
  // while ND and anything outside the sphere is kept.
  const pois = useMemo<MapPoi[]>(() => {
    const all = combinePois(poiStore.items, mobStore?.items ?? []);
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
  }, [poiStore.items, mobStore?.items]);

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  /** Cell reference → sector name, shared by the floor markings and the toolbar. */
  const sectorNames = useMemo(() => deriveSectorNames(pois), [pois]);
  /**
   * Drill-down state. `null` = the overview: stations and gates only, with the
   * sector grid live for hover/click. Set to a cell and the camera flies in and
   * the rest of that space's detail appears.
   */
  const [sector, setSector] = useState<{ c: number; r: number } | null>(null);
  // The render loop and pointer handlers live inside the scene effect, which
  // must not rebuild when the view mode changes — a ref carries it across.
  const sectorRef = useRef<{ c: number; r: number } | null>(null);
  sectorRef.current = sector;
  /** Set by the scene; flies the camera back to the opening overview pose. */
  const flyHomeRef = useRef<(() => void) | null>(null);
  /** Set by the scene; animates the camera to an arbitrary pose. */
  const flyToRef = useRef<((pos: THREE.Vector3, tgt: THREE.Vector3) => void) | null>(null);
  /**
   * When the in-progress camera flight lands (ms, performance.now clock). The
   * visibility effect defers marker reveals until then, so a sector's contents
   * arrive once you're there rather than streaming past you on the way in.
   * A stale value is harmless — it's already in the past, so the delay is zero.
   */
  const flightEndsAtRef = useRef(0);
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
    // Never initialise from a zero-sized container. `clientWidth/clientHeight`
    // can both be 0 if the scene is built before layout has settled, and
    // `0 / 0` is NaN — which poisons the camera's projection matrix and renders
    // an empty frame forever after. Dev hid this: StrictMode builds the scene
    // twice, so the second (settled) build masked a bad first one.
    const w0 = mount.clientWidth || 1;
    const h0 = mount.clientHeight || 1;
    renderer.setSize(w0, h0);
    // Transparent clear — the app's own backdrop and grid show through instead of
    // a painted-on black, so the scene sits on the window rather than in a box.
    // The starfield below is real geometry, so it survives.
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0x8899bb, 1.1));

    // Starfield
    const starGeo = new THREE.BufferGeometry();
    const stars = new Float32Array(2500 * 3);
    for (let i = 0; i < stars.length; i++) stars[i] = (Math.random() - 0.5) * 120;
    starGeo.setAttribute("position", new THREE.BufferAttribute(stars, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 0.05, color: 0x8fa0c0, transparent: true, opacity: 0.5 })));

    const camera = new THREE.PerspectiveCamera(50, w0 / h0, 0.01, 500);
    camera.position.set(0, 6, 9);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1;
    controls.maxDistance = 60;
    // Zoom toward the pointer rather than the pivot. Direct manipulation: the
    // thing under your cursor is what you're aiming at, so scrolling shouldn't
    // require re-centring afterwards.
    controls.zoomToCursor = true;
    // Stop the camera dropping below the ecliptic, where the floor markings
    // render mirrored and the grid reads inverted — easy to get lost, and no
    // useful view down there.
    controls.maxPolarAngle = THREE.MathUtils.degToRad(88);

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
    // Flat sector names — faded out by viewing angle in the render loop.
    const sectorLabels: THREE.Mesh[] = [];
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
      // The four lootable-PVP cells (C2, C3, D3, E2) get a faint red wash, so
      // the hazard is legible at a glance rather than only from the seam colour
      // and the label tint. Drawn first and behind everything else so markers
      // and seams stay on top.
      {
        const cellSize = GRID_CELL_EU * scale;
        const fillMat = new THREE.MeshBasicMaterial({
          color: PVP_COLOR,
          transparent: true,
          opacity: GRID_PVP_FILL_OPACITY,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        for (const [c, r] of GRID_PVP_CELLS) {
          const ex0 = GRID_ORIGIN_EU.x + c * GRID_CELL_EU;
          const ey0 = GRID_ORIGIN_EU.y + r * GRID_CELL_EU;
          const fill = new THREE.Mesh(new THREE.PlaneGeometry(cellSize, cellSize), fillMat);
          // PlaneGeometry is built in XY; the map's ground plane is XZ.
          fill.rotation.x = -Math.PI / 2;
          fill.position.copy(gp(ex0 + GRID_CELL_EU / 2, ey0 + GRID_CELL_EU / 2));
          fill.renderOrder = -3;
          fill.updateMatrix();
          fill.matrixAutoUpdate = false;
          scene.add(fill);
        }

        // Sector names painted flat on the ecliptic, like markings on a pitch.
        // Lying in the plane rather than facing the camera is the whole point:
        // perspective foreshortens and shrinks them for free, so they read as
        // part of the space instead of joining the label layer that was already
        // crowded. Dimmed and drawn under everything else.
        for (let c = 0; c < GRID_COLS; c++) {
          for (let r = 0; r < GRID_ROWS; r++) {
            const ref = cellRef(c, r);
            const name = sectorNames.get(ref) ?? ref;
            const pvp = GRID_PVP_CELLS.some(([pc, pr]) => pc === c && pr === r);
            const { tex, aspect } = drawFloorText(
              name.toUpperCase(),
              pvp ? "#ff6b6b" : "#9fb2cc",
            );
            // Constant cap-height so every sector reads at the same size, only
            // shrinking when a long name would overrun its cell.
            let h = cellSize * SECTOR_LABEL_HEIGHT;
            let w = h * aspect;
            const maxW = cellSize * 0.85;
            if (w > maxW) {
              w = maxW;
              h = w / aspect;
            }
            const mesh = new THREE.Mesh(
              new THREE.PlaneGeometry(w, h),
              new THREE.MeshBasicMaterial({
                map: tex,
                transparent: true,
                opacity: SECTOR_LABEL_OPACITY,
                depthWrite: false,
                side: THREE.DoubleSide,
              }),
            );
            mesh.rotation.x = -Math.PI / 2;
            const ex0 = GRID_ORIGIN_EU.x + c * GRID_CELL_EU;
            const ey0 = GRID_ORIGIN_EU.y + r * GRID_CELL_EU;
            mesh.position.copy(
              gp(ex0 + GRID_CELL_EU / 2, ey0 + GRID_CELL_EU * SECTOR_LABEL_EDGE),
            );
            mesh.renderOrder = -2;
            mesh.updateMatrix();
            mesh.matrixAutoUpdate = false;
            scene.add(mesh);
            sectorLabels.push(mesh);
          }
        }
      }

      // Seams get the PVP sphere's treatment — they mark the same hazard, since
      // crossing an interior seam is what puts you in PVP. Two passes: a wide
      // ribbon carrying the glow falloff, and a faint core on top so the seam
      // stays locatable when zoomed out (the glow alone goes mushy at distance).
      // Both are deliberately dim — see GRID_GLOW_INTENSITY.
      const glow = new THREE.Mesh(
        buildGlowRibbons(linePts, GRID_CELL_EU * scale * GRID_GLOW_WIDTH),
        glowRibbonMaterial(PVP_COLOR, 2.6, GRID_GLOW_INTENSITY),
      );
      glow.matrixAutoUpdate = false;
      glow.renderOrder = -1; // behind the markers, like the sphere
      scene.add(glow);

      const gridLines = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(linePts),
        new THREE.LineBasicMaterial({
          color: PVP_COLOR,
          transparent: true,
          opacity: 0.14,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      gridLines.matrixAutoUpdate = false;
      scene.add(gridLines);

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
        // Space station — a solid orb, 3× the belt markers. The fresnel halo
        // that used to wrap it read as a ring at distance and competed with the
        // PVP sphere's rim for the same visual language.
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(radius * 3.15, 24, 24),
          new THREE.MeshBasicMaterial({ color }),
        );
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
      // Remember the resting colour so the depth pass can dim toward the
      // background and restore exactly, without touching transparency (which
      // would force sorting across hundreds of markers).
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (mat.color) mesh.userData.baseColor = mat.color.clone();
      if (mat.transparent) mesh.userData.baseOpacity = mat.opacity;
      mesh.userData.revealJitter = Math.random() * REVEAL_STAGGER_MS;
      mesh.userData.depthCue = !(gate || zone || spacest); // big landmarks stay solid
      const objs: THREE.Object3D[] = [mesh];

      const label = labelFor(p);
      if (label) {
        const spr = makeLabel(label, "#" + new THREE.Color(color).getHexString());
        spr.position.copy(pos);
        spr.position.y += spacest ? 0.3 : 0.18;
        spr.userData.poiId = p.id;
        spr.userData.isLabel = true;
        spr.userData.labelRange = LABEL_RANGE[p.category] ?? LABEL_RANGE_DEFAULT;
        spr.userData.revealJitter = Math.random() * REVEAL_STAGGER_MS;
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
      const zoneMesh = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 32), fresnelMaterial(PVP_COLOR, 3.0, 0.9));
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
    const pLabel = makeLabel("YOU", "#ffd54a", true);
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
    const measureLabel = makeLabel(" ", "#ffd54a", true);
    measureLabel.visible = false;
    measureLabel.renderOrder = 1000;
    measureLabel.userData.pinned = true;
    scene.add(measureLabel);
    labels.push(measureLabel);

    // Interaction
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    // ── Sector drill-down ─────────────────────────────────────────────────
    // The grid is a pick target in the overview: hover lights a cell, clicking
    // flies the camera into it. Picking is a ray/plane solve against the
    // ecliptic (y = 0) rather than raycasting geometry — no meshes needed and
    // it works over empty space between markers.
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const groundHit = new THREE.Vector3();
    const cellSizeW = GRID_CELL_EU * scale;

    /** Cell under the pointer, or null when off-grid. */
    const pickCell = (): { c: number; r: number } | null => {
      if (!raycaster.ray.intersectPlane(groundPlane, groundHit)) return null;
      // Invert euToThree: X = (eux-cx)*s and Z = -(euy-cy)*s.
      const eux = groundHit.x / scale + center.x;
      const euy = -groundHit.z / scale + center.y;
      const c = Math.floor((eux - GRID_ORIGIN_EU.x) / GRID_CELL_EU);
      const r = Math.floor((euy - GRID_ORIGIN_EU.y) / GRID_CELL_EU);
      if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) return null;
      return { c, r };
    };

    // One reusable quad parked over whichever cell is hovered.
    const cellHighlight = new THREE.Mesh(
      new THREE.PlaneGeometry(cellSizeW, cellSizeW),
      new THREE.MeshBasicMaterial({
        color: 0x8fd3ff,
        transparent: true,
        opacity: 0.07,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    cellHighlight.rotation.x = -Math.PI / 2;
    cellHighlight.renderOrder = -2;
    cellHighlight.visible = false;
    scene.add(cellHighlight);
    let hoverCell: { c: number; r: number } | null = null;

    // Camera flight, lerped in the render loop. Any manual input cancels it so
    // the controls never fight an animation mid-drag.
    // 450ms sits under the Doherty threshold (past ~400ms waiting starts to
    // register) and in the same family as the card's 220ms slide, so camera and
    // UI motion read as one system rather than two.
    const flight = {
      t: 0,
      dur: 0.45,
      active: false,
      fromPos: new THREE.Vector3(),
      toPos: new THREE.Vector3(),
      fromTgt: new THREE.Vector3(),
      toTgt: new THREE.Vector3(),
    };
    // The pose the map opens at. Closing a sector flies back to exactly this,
    // so "back to overview" always lands somewhere predictable rather than
    // wherever you happened to have dragged to before drilling in.
    const homePos = camera.position.clone();
    const homeTgt = controls.target.clone();

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const flyTo = (pos: THREE.Vector3, tgt: THREE.Vector3) => {
      // WCAG 2.3.3 — cut straight to the destination when motion is unwelcome.
      if (reduceMotion) {
        camera.position.copy(pos);
        controls.target.copy(tgt);
        controls.update();
        flight.active = false;
        flightEndsAtRef.current = 0; // arrived already; nothing to wait for
        return;
      }
      flightEndsAtRef.current = performance.now() + flight.dur * 1000;
      flight.fromPos.copy(camera.position);
      flight.fromTgt.copy(controls.target);
      flight.toPos.copy(pos);
      flight.toTgt.copy(tgt);
      flight.t = 0;
      flight.active = true;
    };

    /** Frame a whole sector, keeping the current viewing angle. */
    const focusSector = (c: number, r: number) => {
      const ex0 = GRID_ORIGIN_EU.x + c * GRID_CELL_EU;
      const ey0 = GRID_ORIGIN_EU.y + r * GRID_CELL_EU;
      const tgt = euToThree(
        ex0 + GRID_CELL_EU / 2,
        ey0 + GRID_CELL_EU / 2,
        center.z,
        center,
        scale,
      );
      const dir = camera.position.clone().sub(controls.target);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0.6);
      dir.normalize();
      // Distance that frames one cell for this FOV, plus a margin.
      const fit = (cellSizeW / 2) / Math.tan((camera.fov * Math.PI) / 360);
      flyTo(tgt.clone().add(dir.multiplyScalar(fit * 1.25)), tgt);
    };
    flyHomeRef.current = () => flyTo(homePos, homeTgt);
    let down = { x: 0, y: 0 };
    // Any manual camera input abandons an in-flight animation, so a drag or a
    // scroll never has to fight it.
    // Right button doubles as "back": OrbitControls pans with it, so only a
    // *static* right click counts — press and release without dragging. Same
    // movement tolerance as the left-click test, so a pan that happens to end
    // near where it started still isn't mistaken for a click.
    let rightDown: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      flight.active = false;
      if (e.button === 2) rightDown = { x: e.clientX, y: e.clientY };
      else down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 2 || !rightDown) return;
      const moved = (e.clientX - rightDown.x) ** 2 + (e.clientY - rightDown.y) ** 2 > 25;
      rightDown = null;
      if (!moved) closeLevelRef.current();
    };
    // Suppress the browser menu so the gesture is ours alone.
    const onContextMenu = (e: Event) => e.preventDefault();
    const onWheel = () => {
      flight.active = false;
    };
    // Fly the camera to a POI, keeping the current viewing angle.
    const focusTo = (mp: MapPoi) => {
      const target = euToThree(mp.euX, mp.euY, mp.euZ, center, scale);
      const dir = camera.position.clone().sub(controls.target);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0.001);
      dir.normalize();
      flyTo(target.clone().add(dir.multiplyScalar(compact ? 1.8 : 2.5)), target);
    };
    // Shared with the marker list and the sector card, so every route to a POI
    // moves the camera the same way.
    flyToRef.current = flyTo;
    // ── Hover ─────────────────────────────────────────────────────────────
    // With labels on a range budget most markers are anonymous dots, so pointing
    // at one has to name it — that's what keeps "find the thing, grab its
    // waypoint" fast without putting every name on screen at once.
    //
    // The pointer handler only records where the cursor is; the actual pick runs
    // once per frame from the render loop. Acting per `pointermove` meant a
    // high-poll mouse could fire 120+ picks a second, each one competing with
    // rendering for the same 16.7ms frame budget. Sampling instead of reacting
    // decouples input rate from work done, and it also keeps hover correct while
    // the camera moves under a stationary cursor.
    const hoverRef = { current: null as string | null };
    const ptr = { px: 0, py: 0, w: 1, h: 1, inside: false };
    const onMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ptr.px = e.clientX - rect.left;
      ptr.py = e.clientY - rect.top;
      ptr.w = rect.width;
      ptr.h = rect.height;
      ptr.inside = true;
    };

    /**
     * Nearest marker to the pointer in *screen* space, within a pixel radius.
     *
     * Fitts's law: these markers are sub-pixel-thin spheres at distance, so
     * ray-hitting their actual geometry makes clicking a precision task. A pixel
     * radius gives every marker the same forgiving target size no matter how far
     * away it is, and it's cheaper than a raycast — a projection per marker, no
     * BVH traversal.
     */
    const projV = new THREE.Vector3();
    const pickMarker = (): string | null => {
      let bestId: string | null = null;
      let bestD = PICK_RADIUS_PX;
      let bestDepth = Infinity;
      const t = performance.now();
      for (const m of pickable) {
        if (!m.visible) continue; // hidden by filters or the overview
        // Waiting on the camera to land — drawn at zero, so not yet a target.
        const at = m.userData.revealAt as number | undefined;
        if (at != null && at > t) continue;
        m.getWorldPosition(projV);
        const depth = camera.position.distanceTo(projV);
        projV.project(camera);
        if (projV.z > 1) continue; // behind the camera
        const sx = (projV.x * 0.5 + 0.5) * ptr.w;
        const sy = (-projV.y * 0.5 + 0.5) * ptr.h;
        const d = Math.hypot(sx - ptr.px, sy - ptr.py);
        if (d > PICK_RADIUS_PX) continue;
        // Closest to the cursor wins; near-ties go to whatever is nearer the
        // camera, so a foreground marker beats one behind it.
        if (d < bestD - 1 || (d < bestD + 1 && depth < bestDepth)) {
          bestD = Math.min(bestD, d);
          bestDepth = depth;
          bestId = (m.userData.poiId as string | undefined) ?? null;
        }
      }
      return bestId;
    };

    // Hover feedback on the marker itself — without it the only confirmation is
    // the cursor, which doesn't tell you *which* dot you're about to click.
    let hoverMesh: THREE.Mesh | null = null;
    const applyHoverScale = (id: string | null) => {
      if (hoverMesh && hoverMesh.userData.poiId !== id) {
        hoverMesh.scale.setScalar(markerScaleRef.current);
        hoverMesh.updateMatrix(); // static markers have matrixAutoUpdate off
        hoverMesh = null;
      }
      if (!id) return;
      // Re-applied every frame rather than only on change: the marker-size
      // slider rescales every marker, which would otherwise flatten the hovered
      // one until the cursor moved off it.
      const m = hoverMesh ?? pickable.find((x) => x.userData.poiId === id);
      if (!m) return;
      m.scale.setScalar(markerScaleRef.current * HOVER_SCALE);
      m.updateMatrix();
      hoverMesh = m;
    };

    const updateHover = () => {
      if (!ptr.inside) return;
      const id = pickMarker();
      hoverRef.current = id;
      applyHoverScale(id);

      // The grid stays pickable in both modes, so you can hop straight from one
      // sector to another without backing out first. A marker under the pointer
      // still wins, since clicking it should select rather than drill in. The
      // sector you're already in doesn't highlight — there's nothing to go to.
      mouse.x = (ptr.px / ptr.w) * 2 - 1;
      mouse.y = -(ptr.py / ptr.h) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const cur = sectorRef.current;
      const over = id ? null : pickCell();
      hoverCell = over && !(cur && cur.c === over.c && cur.r === over.r) ? over : null;
      if (hoverCell) {
        const ex0 = GRID_ORIGIN_EU.x + hoverCell.c * GRID_CELL_EU;
        const ey0 = GRID_ORIGIN_EU.y + hoverCell.r * GRID_CELL_EU;
        cellHighlight.position.copy(
          euToThree(ex0 + GRID_CELL_EU / 2, ey0 + GRID_CELL_EU / 2, center.z, center, scale),
        );
        cellHighlight.visible = true;
      } else {
        cellHighlight.visible = false;
      }
      renderer.domElement.style.cursor = id || hoverCell ? "pointer" : "";
    };

    const onLeave = () => {
      ptr.inside = false;
      hoverRef.current = null;
      applyHoverScale(null);
      hoverCell = null;
      cellHighlight.visible = false;
      renderer.domElement.style.cursor = "";
    };
    const onClick = (e: MouseEvent) => {
      if ((e.clientX - down.x) ** 2 + (e.clientY - down.y) ** 2 > 25) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      // Clicking a POI (its label sits on top, so test labels first, else the
      // marker) focuses it and kicks off the measure flow via `selected`.
      // Same screen-space picker the hover uses, so what lights up under the
      // cursor is always what a click selects. Labels sit offset above their
      // marker, so they still need a ray of their own.
      ptr.px = e.clientX - rect.left;
      ptr.py = e.clientY - rect.top;
      ptr.w = rect.width;
      ptr.h = rect.height;
      const labelHit = raycaster
        .intersectObjects(labels)
        .find((h) => h.object.visible && h.object.userData.poiId);
      const id = (pickMarker() ?? labelHit?.object.userData.poiId) as string | undefined;
      if (id) {
        const mp = pois.find((p) => p.id === id);
        if (mp) {
          focusTo(mp);
          setSelected(mp);
          // Drilling in via a marker: the sector it sits in becomes the active
          // one, so its detail and dossier come up just as if the cell had been
          // clicked. Skipped when it's already active, so nothing re-reveals.
          const cl = cellOfPoi(mp);
          const cur = sectorRef.current;
          if (cl && !(cur && cur.c === cl.c && cur.r === cl.r)) setSector(cl);
        }
        return;
      }
      // No marker under the pointer: a click on the grid drills into that
      // sector, from the overview or from another sector. Clicking empty space
      // inside the sector you're already in just clears the selection, so
      // dismissing a detail panel can't throw the camera around.
      const cell = pickCell();
      const cur = sectorRef.current;
      if (cell && !(cur && cur.c === cell.c && cur.r === cell.r)) {
        focusSector(cell.c, cell.r);
        setSector(cell);
        setSelected(null);
        hoverCell = null;
        cellHighlight.visible = false;
        return;
      }
      setSelected(null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("click", onClick);

    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: true });
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    let raf = 0;
    const start = performance.now();
    let prev = start;
    const tmpV = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min((now - prev) / 1000, 0.05);
      prev = now;

      // One hover pick per frame, regardless of how fast the mouse reports.
      updateHover();

      // Sector flight. Ease-in-out over `dur`, driving both camera and pivot so
      // the controls stay consistent when it lands.
      if (flight.active) {
        flight.t = Math.min(flight.t + dt / flight.dur, 1);
        const e = flight.t < 0.5
          ? 4 * flight.t ** 3
          : 1 - Math.pow(-2 * flight.t + 2, 3) / 2;
        camera.position.lerpVectors(flight.fromPos, flight.toPos, e);
        controls.target.lerpVectors(flight.fromTgt, flight.toTgt, e);
        if (flight.t >= 1) flight.active = false;
      }

      controls.update();
      for (const sp of spinners) sp.o.rotation[sp.ax] += sp.sp * dt;
      if (playerGroup.visible) {
        const t = (now - start) / 1000;
        arrow.scale.setScalar(1 + Math.sin(t * 3) * 0.1);
      }

      // Sector names fade out as the camera drops toward the plane: flat text
      // seen edge-on is unreadable smear, and that's exactly when you're down
      // among the rocks and don't want it anyway. |dir.y| is 1 looking straight
      // down, 0 looking level.
      if (sectorLabels.length) {
        camera.getWorldDirection(camDir);
        const a = THREE.MathUtils.smoothstep(Math.abs(camDir.y), 0.1, 0.42);
        for (const m of sectorLabels) {
          const mat = m.material as THREE.MeshBasicMaterial;
          mat.opacity = SECTOR_LABEL_OPACITY * a;
          m.visible = mat.opacity > 0.01;
        }
      }

      // ── Depth cue ────────────────────────────────────────────────────────
      // Distances are measured against the camera-to-pivot distance, so the
      // effect is relative to what you're looking at and survives any zoom.
      const focal = Math.max(camera.position.distanceTo(controls.target), 0.001);
      const near = focal * DEPTH_NEAR;
      const far = focal * DEPTH_FAR;
      /** 1 at/inside the focal depth → 0 well behind it. */
      const depthT = (d: number) =>
        far <= near ? 1 : 1 - THREE.MathUtils.clamp((d - near) / (far - near), 0, 1);

      /**
       * 0 → 1 over REVEAL_MS after an object was revealed, smoothstepped, with
       * its own stagger applied first. Returns 1 for anything not mid-fade, and
       * clears the stamp on completion so finished markers cost nothing.
       */
      const revealOf = (o: THREE.Object3D): number => {
        const at = o.userData.revealAt as number | undefined;
        if (at == null) return 1;
        const t = (now - at - ((o.userData.revealJitter as number) ?? 0)) / REVEAL_MS;
        if (t >= 1) {
          o.userData.revealAt = undefined;
          return 1;
        }
        if (t <= 0) return 0;
        return t * t * (3 - 2 * t);
      };

      for (const m of pickable) {
        if (!m.visible) continue;
        const rev = revealOf(m);
        const cue = m.userData.depthCue as boolean;
        // Settled and not depth-cued → nothing changes frame to frame.
        if (rev >= 1 && !cue) continue;
        const mat = m.material as THREE.MeshBasicMaterial;
        // Transparent markers (outlaw zones, gates) fade on alpha; opaque ones
        // fade their colour toward the background, which avoids switching
        // materials to transparent mid-flight and forcing a shader recompile.
        const baseOp = m.userData.baseOpacity as number | undefined;
        if (baseOp != null) mat.opacity = baseOp * rev;
        const base = m.userData.baseColor as THREE.Color | undefined;
        if (base) {
          let f = rev;
          if (cue) {
            m.getWorldPosition(tmpV);
            f *= DEPTH_MIN + (1 - DEPTH_MIN) * depthT(camera.position.distanceTo(tmpV));
          }
          mat.color.copy(base).multiplyScalar(f);
        }
      }

      // Labels: hold a constant on-screen size at every zoom (distance × factor
      // cancels perspective), but fade and drop out with depth so the scene
      // reads as a volume rather than a flat wall of names. Each category has a
      // range beyond which its label isn't worth the ink (see LABEL_RANGE);
      // hovering a marker always brings its own name back.
      const hoverId = hoverRef.current;
      for (const lb of labels) {
        if (lb.parent === playerGroup && !playerGroup.visible) continue;
        if (!lb.userData.pinned) lb.visible = !lb.userData.filteredHidden;
        if (!lb.visible) continue;
        lb.getWorldPosition(tmpV);
        const dist = camera.position.distanceTo(tmpV);
        const forced = lb.userData.pinned || lb.userData.poiId === hoverId;
        const range = (lb.userData.labelRange as number) ?? Infinity;
        if (!forced && dist > range) {
          lb.visible = false;
          continue;
        }
        const mat = lb.material as THREE.SpriteMaterial;
        const depthOp = forced ? 1 : DEPTH_MIN_LABEL + (1 - DEPTH_MIN_LABEL) * depthT(dist);
        mat.opacity = depthOp * revealOf(lb);
        const s = Math.max(dist * labelSizeRef.current, 0.01);
        const a = (lb.userData.aspect as number) ?? 3;
        lb.scale.set(a * s, s, 1);
      }

      renderer.render(scene, camera);
    };
    loop();

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return; // hidden / zero-sized — keep the last good size
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);
    // The container resizes without the window doing so — collapsing the rail,
    // the page gutter changing, or layout settling after first paint. A window
    // listener alone leaves the canvas at its mount-time size, which is what
    // left dead space along the bottom and right edges.
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

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
        ro.disconnect();
        window.removeEventListener("resize", onResize);
        renderer.domElement.removeEventListener("pointerdown", onDown);
        renderer.domElement.removeEventListener("click", onClick);
        renderer.domElement.removeEventListener("pointerup", onUp);
        renderer.domElement.removeEventListener("contextmenu", onContextMenu);
        renderer.domElement.removeEventListener("wheel", onWheel);
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerleave", onLeave);
        controls.dispose();
        renderer.dispose();
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      },
    };
    return () => sceneRef.current?.dispose();
  }, [pois, sectorNames]);

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
    const now = performance.now();
    // Markers become visible immediately but sit at zero brightness until the
    // camera arrives — so they can't be seen streaking past during the flight.
    const revealFrom = Math.max(now, flightEndsAtRef.current);
    for (const p of pois) {
      // Two gates: the user's own type filters, and the view mode. The overview
      // draws destinations only, so the belt reads as a handful of places to go
      // rather than a field of rocks. A focused sector draws everything inside
      // that cell and nothing outside it — that containment is the whole point
      // of drilling in, and without it focusing just dumped the entire belt back
      // on screen.
      const cell = sector ? cellOfPoi(p) : null;
      const inView = sector
        ? cell != null && cell.c === sector.c && cell.r === sector.r
        : OVERVIEW_CATEGORIES.has(p.category);
      const visible = !hidden.has(filterGroupOf(p)) && inView;
      data.meshes.get(p.id)?.forEach((o) => {
        // Labels are owned by the render loop's collision pass — flag them here
        // rather than forcing visibility, so filtering + culling don't fight.
        if (o.userData.isLabel) {
          // Only stamp on a false → true edge, so re-running this effect for an
          // unrelated reason can't restart a fade that already finished.
          if (visible && o.userData.filteredHidden) o.userData.revealAt = revealFrom;
          o.userData.filteredHidden = !visible;
        } else {
          if (visible && !o.visible) o.userData.revealAt = revealFrom;
          o.visible = visible;
        }
      });
    }
  }, [pois, hidden, sector]);

  const loggedCount = poiStore.items.filter((p) => p.logged_at != null).length;
  const sectorTitle = sector ? sectorNames.get(cellRef(sector.c, sector.r)) ?? "" : "";

  /**
   * Back out one level — selection first, then the sector. Shared by Esc, the
   * card's ✕ and a static right click, so every route unwinds identically.
   * Held in a ref because the scene's pointer handlers outlive any one render.
   */
  const closeLevelRef = useRef<() => void>(() => {});

  /** Leave the focused sector and scale back out to the overview. */
  const exitSector = () => {
    setSector(null);
    setSelected(null);
    flyHomeRef.current?.();
  };

  closeLevelRef.current = () => {
    if (selected) setSelected(null);
    else if (sector) exitSector();
  };

  /** POIs inside the focused sector, for the dossier card. */
  const sectorPois = useMemo(() => {
    if (!sector) return [];
    return poiStore.items.filter((p) => {
      const cl = cellOfEu(p.eu_x, p.eu_y);
      return cl != null && cl.c === sector.c && cl.r === sector.r;
    });
  }, [poiStore.items, sector]);

  // Esc backs out of a sector to the overview.
  useEffect(() => {
    if (!sector) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Same unwind order as the card's ✕: drop a selection first, and only
      // leave the sector once there's nothing selected to back out of.
      if (selected) setSelected(null);
      else exitSector();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sector, selected]);

  // Fly the map camera to a POI (keeping the current view angle) and open it.
  const focusPoi = (poi: Poi) => {
    const d = sceneRef.current;
    if (!d) return;
    const p = euToThree(poi.eu_x, poi.eu_y, poi.eu_z, d.center, d.scale);
    const dir = d.camera.position.clone().sub(d.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 1);
    dir.normalize();
    const pos = p.clone().add(dir.multiplyScalar(2.5));
    if (flyToRef.current) {
      flyToRef.current(pos, p);
    } else {
      d.controls.target.copy(p);
      d.camera.position.copy(pos);
      d.controls.update();
    }
    setSelected(pois.find((mp) => mp.id === poi.id) ?? null);
    // Same rule as clicking a marker on the map — the POI's sector becomes active.
    const cl = cellOfEu(poi.eu_x, poi.eu_y);
    if (cl && !(sector && sector.c === cl.c && sector.r === cl.r)) setSector(cl);
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
              {sector ? (
                <button
                  className="mtchip mtchip--back"
                  onClick={exitSector}
                  title="Back to all sectors (Esc)"
                >
                  ← <b>{sectorTitle}</b>
                </button>
              ) : (
                <span className="mtchip mtchip--hint">Click a sector to focus</span>
              )}
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

          {sector && (
            <SectorCard
              name={sectorTitle}
              cell={cellRef(sector.c, sector.r)}
              pvp={GRID_PVP_CELLS.some(([pc, pr]) => pc === sector.c && pr === sector.r)}
              pois={sectorPois}
              selected={selected}
              onClose={exitSector}
              onClearSelection={() => setSelected(null)}
              onFocus={focusPoi}
            />
          )}

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
              <PoiEditor
                poiStore={poiStore}
                mobStore={mobStore}
                onFocus={focusPoi}
              />
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
