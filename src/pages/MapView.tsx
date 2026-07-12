import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { useAsteroids } from "../hooks/useAsteroids";
import type { usePois } from "../hooks/usePois";
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
};
const M_BARE = 0x5b6470;

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
  { key: "logged", label: "Logged", color: "#e6e9f2" },
];

/** Which toggle group a POI belongs to. */
function groupOf(p: MapPoi): string {
  if (p.logged) return "logged";
  if (isBareM(p)) return "anchor";
  return p.category;
}

function euToThree(
  x: number,
  y: number,
  z: number,
  c: { x: number; y: number; z: number },
  s: number,
): THREE.Vector3 {
  return new THREE.Vector3((x - c.x) * s, (z - c.z) * s, -(y - c.y) * s);
}

function makeLabel(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = "bold 42px 'IBM Plex Mono', monospace";
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width + 40);
  const h = 64;
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  const H = 0.16;
  sprite.scale.set((w / h) * H, H, 1);
  return sprite;
}

export function MapView({
  store,
  poiStore,
  playerPos,
  compact = false,
}: {
  store: ReturnType<typeof useAsteroids>;
  poiStore: ReturnType<typeof usePois>;
  playerPos: PlayerPos | null;
  /** Radar mode: chrome hidden, camera follows the player. */
  compact?: boolean;
}) {
  // Merge static HM context + editable POIs + live logged rocks.
  const pois = useMemo<MapPoi[]>(
    () => combinePois(store.items, poiStore.items),
    [store.items, poiStore.items],
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
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    meshes: Map<string, THREE.Object3D[]>;
    player: THREE.Group;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    center: { x: number; y: number; z: number };
    scale: number;
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

    const meshes = new Map<string, THREE.Object3D[]>();
    const pickable: THREE.Mesh[] = [];
    const pvpZonePos: THREE.Vector3[] = [];

    for (const p of pois) {
      const pos = euToThree(p.euX, p.euY, p.euZ, center, scale);
      const bare = isBareM(p);
      const station = p.category === "station";
      const spacest = p.category === "space-station";
      const gate = p.category === "warp-gate";
      const zone = p.category === "outlaw-zone";
      const color = bare ? M_BARE : CAT_COLOR[p.category] ?? 0x888888;
      const radius = station ? 0.09 : spacest ? 0.075 : gate ? 0.07 : zone ? 0.07 : bare ? 0.03 : p.logged ? 0.055 : 0.04;
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
        scene.add(spr);
        objs.push(spr);
      }
      // The PVP zone hugs the bare-M anchor field (the belt skeleton).
      if (bare) pvpZonePos.push(pos);
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

    // Player "YOU" marker — gold, pulsing; positioned by the effect below.
    const playerGroup = new THREE.Group();
    const pColor = 0xffd54a;
    const pCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 16, 16),
      new THREE.MeshStandardMaterial({ color: pColor, emissive: pColor, emissiveIntensity: 1 }),
    );
    const pRing = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.18, 32),
      new THREE.MeshBasicMaterial({ color: pColor, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    const pLabel = makeLabel("YOU", "#ffd54a");
    pLabel.position.y = 0.26;
    playerGroup.add(pCore, pRing, pLabel);
    playerGroup.visible = false;
    scene.add(playerGroup);

    // Interaction
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onClick = (e: MouseEvent) => {
      if ((e.clientX - down.x) ** 2 + (e.clientY - down.y) ** 2 > 25) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hit = raycaster.intersectObjects(pickable)[0];
      if (hit) {
        const id = hit.object.userData.poiId as string;
        setSelected(pois.find((p) => p.id === id) ?? null);
      } else setSelected(null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("click", onClick);

    let raf = 0;
    const start = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      if (playerGroup.visible) {
        const t = (performance.now() - start) / 1000;
        pRing.lookAt(camera.position);
        (pRing.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(t * 3) * 0.25;
        pCore.scale.setScalar(1 + Math.sin(t * 3) * 0.12);
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

  // Place the "YOU" marker at the last-known player position.
  useEffect(() => {
    const d = sceneRef.current;
    if (!d) return;
    if (!playerPos) {
      d.player.visible = false;
      return;
    }
    const tgt = euToThree(playerPos.x, playerPos.y, playerPos.z, d.center, d.scale);
    d.player.position.copy(tgt);
    d.player.visible = true;
    // Radar: follow the player by panning the view (translate camera + target by
    // the same delta) — preserves the user's current angle and zoom.
    if (compact) {
      const delta = tgt.clone().sub(d.controls.target);
      d.camera.position.add(delta);
      d.controls.target.add(delta);
      d.controls.update();
    }
  }, [playerPos, pois, compact]);

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

  return (
    <div className="map">
      {compact ? null : <PoiEditor poiStore={poiStore} />}

      <div className="map__view">
      <div ref={mountRef} className="map__canvas" />

      {compact ? null : (
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
