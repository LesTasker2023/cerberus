import { invoke } from "@tauri-apps/api/core";
import { useAsteroids } from "../hooks/useAsteroids";
import { usePois } from "../hooks/usePois";
import { usePlayerPosition } from "../hooks/usePlayerPosition";
import { MapView } from "./MapView";

/** Always-on-top overlay: the real 3D map, in compact mode centred on you. */
export function BattleRadar() {
  const store = useAsteroids();
  const poiStore = usePois();
  const playerPos = usePlayerPosition();

  return (
    <div className="radar">
      <div className="radar__bar" data-tauri-drag-region>
        <span className="radar__title">MAP</span>
        <button
          className="radar__hide"
          onClick={() => invoke("hide_window", { label: "radar" })}
          aria-label="Hide"
        >
          ✕
        </button>
      </div>
      <MapView store={store} poiStore={poiStore} playerPos={playerPos} compact />
    </div>
  );
}
