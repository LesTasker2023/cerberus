import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAsteroids } from "../hooks/useAsteroids";
import { usePois } from "../hooks/usePois";
import { usePlayerPosition } from "../hooks/usePlayerPosition";
import { MapView } from "./MapView";

/** Always-on-top overlay: the real 3D map, in compact radar mode centred on you. */
export function BattleRadar() {
  const store = useAsteroids();
  const poiStore = usePois();
  const playerPos = usePlayerPosition();

  return (
    <div className="radar">
      <div className="radar__bar" data-tauri-drag-region>
        <span className="radar__title">RADAR</span>
        <button className="radar__hide" onClick={() => getCurrentWindow().hide()} aria-label="Hide">
          ✕
        </button>
      </div>
      <MapView store={store} poiStore={poiStore} playerPos={playerPos} compact />
    </div>
  );
}
