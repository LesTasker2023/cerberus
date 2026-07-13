import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import type { useAsteroids } from "../hooks/useAsteroids";
import type { useEncounters } from "../hooks/useEncounters";
import type { usePois, Poi } from "../hooks/usePois";
import type { PlayerPos } from "../hooks/usePlayerPosition";
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
};
const M_BARE = 0x5b6470;

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
const LABELLED = new Set(["station", "space-station", "warp-gate", "landmark", "outlaw-zone"]);
function labelFor(p: MapPoi): string | null {
  if (LABELLED.has(p.category)) return p.name;
  if (!p.logged) return null;
  if (p.category === "asteroid-m") {
    const s = sizeOf(p.name);
    return s ? intToRoman(s) : "M";
  }
  return p.name;
}

/** Toggleable POI groups (order = display order), with legend swatch colour. */
const LEGEND: { key: string; label: string; color: string }[] = [
  { key: "warp-gate", label: "Warp Gates", color: "#b98cff" },
  { key: "space-station", label: "Planets", color: "#5ec8d8" },
  { key: "landmark", label: "Landmarks", color: "#d9a441" },
  { key: "station", label: "Station", color: "#46b0c4" },
  { key: "anchor", label: "M Anchors", color: "#5b6470" },
  { key: "asteroid-m", label: "M-Type", color: "#3f7fff" },
  { key: "asteroid-nd", label: "ND-Type", color: "#a86fc0" },
  { key: "asteroid-c", label: "C-Type", color: "#b08a55" },
  { key: "asteroid-s", label: "S-Type", color: "#6f96ad" },
  { key: "asteroid-f", label: "F-Type", color: "#5aa06a" },
  { key: "asteroid-scrap", label: "Scrap", color: "#8a8f99" },
  { key: "outlaw-zone", label: "Outlaw", color: "#84cc16" },
  { key: "mob", label: "Mobs", color: "#f2683c" },
  { key: "logged", label: "Logged", color: "#e6e9f2" },
];

/** Which toggle group a POI belongs to. */
function groupOf(p: MapPoi): string {
  if (p.logged) return "logged";
  if (isBareM(p)) return "anchor";
  return p.category;
}

/** Compact EU distance for the ring readout (e.g. 3800 → "3.8k"). */
const fmtEU = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);

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

/** Render text to a high-res canvas texture (crisp when scaled up on screen). */
function drawLabelTexture(text: string, color: string): { tex: THREE.CanvasTexture; aspect: number } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = "bold 72px 'IBM Plex Mono', monospace";
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width + 56);
  const h = 96;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  return { tex, aspect: w / h };
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
  compact = false,
}: {
  store: ReturnType<typeof useAsteroids>;
  poiStore: ReturnType<typeof usePois>;
  playerPos: PlayerPos | null;
  /** Logged mob encounters — plotted as spawn points + wrapped in a sphere. */
  mobStore?: ReturnType<typeof useEncounters>;
  /** Radar mode: chrome hidden, camera follows the player. */
  compact?: boolean;
}) {
  // Merge static HM context + editable POIs + logged rocks + mob spawns.
  const pois = useMemo<MapPoi[]>(
    () => combinePois(store.items, poiStore.items, mobStore?.items ?? []),
    [store.items, poiStore.items, mobStore?.items],
  );

  const sizeBounds = useMemo<[number, number]>(() => {
    const vals = pois
      .filter((p) => p.category === "asteroid-m")
      .map((p) => sizeOf(p.name))
      .filter((v): v is number => v != null);
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [1, 20];
  }, [pois]);
  const [range, setRange] = useState<[number, number]>(sizeBounds);
  useEffect(() => setRange(sizeBounds), [sizeBounds]);

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of pois) c[groupOf(p)] = (c[groupOf(p)] ?? 0) + 1;
    return c;
  }, [pois]);
  const toggle = (k: string) =>
    setHidden((h) => {
      const n = new Set(h);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const [selected, setSelected] = useState<MapPoi | null>(null);
  const [ringInfo, setRingInfo] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [wpChip, setWpChip] = useState<string | null>(null);
  // Click-to-measure: the player position captured on the last POI click, the
  // straight-line distance to that POI, and a bump to re-fire on re-clicks.
  const [measurePos, setMeasurePos] = useState<{ x: number; y: number; z: number } | null>(null);
  const [measureTick, setMeasureTick] = useState(0);
  // Per-machine label size (persisted). A ref feeds the render loop so the
  // slider updates live without rebuilding the scene.
  const [labelSize, setLabelSize] = useState<number>(() => {
    const v = Number(localStorage.getItem(LABEL_STORE_KEY));
    return v >= LABEL_SIZE_MIN && v <= LABEL_SIZE_MAX ? v : LABEL_SIZE_DEFAULT;
  });
  const labelSizeRef = useRef(labelSize);
  labelSizeRef.current = labelSize;
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    meshes: Map<string, THREE.Object3D[]>;
    player: THREE.Group;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    center: { x: number; y: number; z: number };
    scale: number;
    stem: THREE.Line | null;
    base: THREE.Mesh | null;
    datumY: number;
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

    for (const p of pois) {
      const pos = euToThree(p.euX, p.euY, p.euZ, center, scale);
      const bare = isBareM(p);
      const station = p.category === "station";
      const spacest = p.category === "space-station";
      const gate = p.category === "warp-gate";
      const zone = p.category === "outlaw-zone";
      const mob = p.category === "mob";
      const color = bare ? M_BARE : CAT_COLOR[p.category] ?? 0x888888;
      const radius = station
        ? 0.075
        : spacest
          ? 0.06
          : gate
            ? 0.055
            : zone
              ? 0.055
              : bare
                ? 0.022
                : mob
                  ? 0.009
                  : p.logged
                    ? 0.038
                    : 0.028;
      const bright = zone || gate || spacest || p.logged;

      const geo = zone
        ? new THREE.OctahedronGeometry(radius)
        : gate
          ? new THREE.TorusGeometry(radius, 0.022, 8, 24) // warp gates read as rings
          : new THREE.SphereGeometry(radius, 16, 16);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: bright ? 0.8 : bare ? 0.3 : 0.45, roughness: 0.4, metalness: 0.6 }),
      );
      mesh.position.copy(pos);
      mesh.userData.poiId = p.id;
      scene.add(mesh);
      pickable.push(mesh);
      const objs: THREE.Object3D[] = [mesh];

      // Translucent zone halo so outlaw areas stand out against the belt.
      if (zone) {
        const halo = new THREE.Mesh(
          new THREE.SphereGeometry(0.15, 16, 16),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.09, depthWrite: false }),
        );
        halo.position.copy(pos);
        scene.add(halo);
        objs.push(halo);
      }

      const label = labelFor(p);
      if (label) {
        const spr = makeLabel(label, "#" + new THREE.Color(color).getHexString());
        spr.position.copy(pos);
        spr.position.y += station ? 0.28 : 0.16;
        spr.userData.poiId = p.id;
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
      const zoneMesh = new THREE.Mesh(
        new THREE.SphereGeometry(r, 24, 24),
        new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }),
      );
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
          new THREE.SphereGeometry(radius, 24, 24),
          new THREE.MeshBasicMaterial({
            color: mobColor,
            transparent: true,
            opacity: 0.09,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        spawn.position.copy(centre);
        scene.add(spawn);
        const core = new THREE.Mesh(
          new THREE.SphereGeometry(0.03, 12, 12),
          new THREE.MeshBasicMaterial({ color: mobColor }),
        );
        core.position.copy(centre);
        scene.add(core);
      }
    }

    // Player "YOU" marker — gold, pulsing; positioned by the effect below.
    const playerGroup = new THREE.Group();
    const pColor = 0xffd54a;
    const pCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.042, 16, 16),
      new THREE.MeshStandardMaterial({ color: pColor, emissive: pColor, emissiveIntensity: 1 }),
    );
    const pRing = new THREE.Mesh(
      new THREE.RingGeometry(0.075, 0.092, 32),
      new THREE.MeshBasicMaterial({ color: pColor, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    const pLabel = makeLabel("YOU", "#ffd54a");
    pLabel.position.y = 0.13;
    labels.push(pLabel);
    playerGroup.add(pCore, pRing, pLabel);
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
    scene.add(measureLabel);
    labels.push(measureLabel);

    // Radar extras: a reference grid at the EU z=0 datum (altitude zero), range
    // rings around the player, and a vertical stem from YOU to the datum so
    // height above/below the plane reads at a glance.
    let radarStem: THREE.Line | null = null;
    let radarBase: THREE.Mesh | null = null;
    const datumY = -center.z * scale;
    if (compact) {
      const grid = new THREE.GridHelper(8, 16, 0x35404e, 0x1e252e);
      grid.position.y = datumY;
      const gm = grid.material as THREE.Material;
      gm.transparent = true;
      gm.opacity = 0.45;
      scene.add(grid);

      const RING_R = [0.35, 0.7, 1.05];
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x4a5563,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      });
      for (const rr of RING_R) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(rr - 0.005, rr, 80), ringMat);
        ring.rotation.x = -Math.PI / 2;
        playerGroup.add(ring);
      }
      setRingInfo(RING_R.map((rr) => fmtEU(rr / scale)).join(" · "));

      radarStem = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, -1, 0),
        ]),
        new THREE.LineBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.5 }),
      );
      playerGroup.add(radarStem);

      radarBase = new THREE.Mesh(
        new THREE.RingGeometry(0.03, 0.045, 24),
        new THREE.MeshBasicMaterial({
          color: 0xffd54a,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
        }),
      );
      radarBase.rotation.x = -Math.PI / 2;
      playerGroup.add(radarBase);
    }

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
          setMeasureTick((n) => n + 1);
        }
      } else setSelected(null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("click", onClick);

    let raf = 0;
    const start = performance.now();
    const tmpV = new THREE.Vector3();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      if (playerGroup.visible) {
        const t = (performance.now() - start) / 1000;
        pRing.lookAt(camera.position);
        (pRing.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(t * 3) * 0.25;
        pCore.scale.setScalar(1 + Math.sin(t * 3) * 0.12);
      }
      // Hold labels at a constant on-screen size at every zoom level — scaling
      // world-height by distance cancels perspective, so they never shrink out.
      for (const lb of labels) {
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

    sceneRef.current = {
      meshes,
      player: playerGroup,
      camera,
      controls,
      center,
      scale,
      stem: radarStem,
      base: radarBase,
      datumY,
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
    const eff =
      measurePos ?? (playerPos ? { x: playerPos.x, y: playerPos.y, z: playerPos.z } : null);
    if (!eff) {
      d.player.visible = false;
      d.measureLine.visible = false;
      d.measureLabel.visible = false;
      return;
    }
    const tgt = euToThree(eff.x, eff.y, eff.z, d.center, d.scale);
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
    if (compact) {
      const drop = tgt.y - d.datumY;
      if (d.stem) d.stem.scale.y = drop || 0.0001;
      if (d.base) d.base.position.y = -drop;
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
  }, [playerPos, measurePos, selected, pois, compact]);

  // When a POI is clicked, fire the `<` position key and store the captured
  // player position; the range line + midpoint readout react to it.
  useEffect(() => {
    if (!selected) {
      setMeasurePos(null);
      return;
    }
    let cancelled = false;
    invoke<{ x: number; y: number; z: number }>("capture_position")
      .then((c) => {
        if (!cancelled) setMeasurePos(c);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // measureTick forces a re-capture when the same POI is clicked again.
  }, [selected, measureTick]);

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
  useEffect(() => {
    const h = (e: StorageEvent) => {
      if (e.key !== LABEL_STORE_KEY || !e.newValue) return;
      const v = Number(e.newValue);
      if (v >= LABEL_SIZE_MIN && v <= LABEL_SIZE_MAX) setLabelSize(v);
    };
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, []);

  // Visibility = type toggle AND size range (M-types only).
  useEffect(() => {
    const data = sceneRef.current;
    if (!data) return;
    for (const p of pois) {
      const sz = p.category === "asteroid-m" ? sizeOf(p.name) : null;
      const inRange = sz == null || (sz >= range[0] && sz <= range[1]);
      const visible = !hidden.has(groupOf(p)) && inRange;
      data.meshes.get(p.id)?.forEach((o) => (o.visible = visible));
    }
  }, [range, pois, hidden]);

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

  return (
    <div className="map">
      {compact ? null : <PoiEditor poiStore={poiStore} onFocus={focusPoi} />}

      <div className="map__view">
      <div ref={mountRef} className="map__canvas" />

      {compact ? (
        <>
          {ringInfo && <div className="radarscale">◎ {ringInfo}</div>}
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
      <div className="map__hud">
        <span className="map__stat">
          Belt <b>{pois.filter(isBareM).length}</b>
        </span>
        <span className="map__stat">
          Logged <b>{loggedCount}</b>
        </span>
        <span className="map__stat map__stat--outlaw">
          Outlaw <b>{pois.filter((p) => p.category === "outlaw-zone").length}</b>
        </span>
      </div>

      <div className="map__controls">
        <div className="map__size">
          <div className="map__sizeHead">
            <span>Labels</span>
            <span className="map__sizeVal">
              {Math.round((labelSize / LABEL_SIZE_DEFAULT) * 100)}%
            </span>
          </div>
          <div className="map__range">
            <input
              type="range"
              min={Math.round(LABEL_SIZE_MIN * 1000)}
              max={Math.round(LABEL_SIZE_MAX * 1000)}
              value={Math.round(labelSize * 1000)}
              aria-label="Label size"
              onChange={(e) => setLabelSize(Number(e.target.value) / 1000)}
            />
          </div>
        </div>

        {sizeBounds[1] > sizeBounds[0] && (
          <div className="map__size">
            <div className="map__sizeHead">
              <span>Size</span>
              <span className="map__sizeVal">
                {intToRoman(range[0])} – {intToRoman(range[1])}
              </span>
            </div>
            <div className="map__range">
              <input
                type="range"
                min={sizeBounds[0]}
                max={sizeBounds[1]}
                value={range[0]}
                aria-label="Minimum size"
                onChange={(e) => setRange(([, hi]) => [Math.min(Number(e.target.value), hi), hi])}
              />
              <input
                type="range"
                min={sizeBounds[0]}
                max={sizeBounds[1]}
                value={range[1]}
                aria-label="Maximum size"
                onChange={(e) => setRange(([lo]) => [lo, Math.max(Number(e.target.value), lo)])}
              />
            </div>
          </div>
        )}
      </div>

      <div className="map__legend">
        {LEGEND.filter((g) => counts[g.key]).map((g) => (
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

      <MapDetail poi={selected} onClose={() => setSelected(null)} onDelete={store.remove} />
        </>
      )}
      </div>
    </div>
  );
}
