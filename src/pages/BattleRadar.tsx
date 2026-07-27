import { usePois } from "../hooks/usePois";
import { usePlayerPosition } from "../hooks/usePlayerPosition";
import { MapView } from "./MapView";

/** Always-on-top radar overlay: the 3D map in compact mode, centred on you.
 *  Chrome-less — a slim grip to drag, everything else driven from the dock. */
export function BattleRadar() {
  const poiStore = usePois();
  const playerPos = usePlayerPosition();

  return (
    <div className="radar">
      <div className="radar__grip" data-tauri-drag-region title="Drag">
        ⠿
      </div>
      <MapView poiStore={poiStore} playerPos={playerPos} compact />
    </div>
  );
}
