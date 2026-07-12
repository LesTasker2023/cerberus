import { useEffect, useState } from "react";
import { IconCheck, IconCopy, IconTrash } from "./icons";

export interface MapPoi {
  id: string;
  name: string;
  category: string;
  euX: number;
  euY: number;
  euZ: number;
  pvpLootable: boolean;
  /** True = user-logged detailed rock; false = static context/anchor. */
  logged: boolean;
}

const CAT_LABEL: Record<string, string> = {
  station: "Station",
  "space-station": "Space Station",
  "warp-gate": "Warp Gate",
  "asteroid-m": "M-Type",
  "asteroid-c": "C-Type",
  "asteroid-f": "F-Type",
  "asteroid-s": "S-Type",
  "asteroid-nd": "ND-Type",
  "asteroid-scrap": "Scrap",
  "outlaw-zone": "Outlaw Zone",
};

export function MapDetail({
  poi,
  onClose,
  onDelete,
}: {
  poi: MapPoi | null;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!poi) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [poi, onClose]);

  if (!poi) return null;

  const copy = () => {
    navigator.clipboard
      .writeText(`/wp [Space, ${poi.euX}, ${poi.euY}, ${poi.euZ}, ${poi.name}]`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  };

  return (
    <div className="mapdet">
      <div className="mapdet__head">
        <div>
          <div className="mapdet__name">{poi.name}</div>
          <div className="mapdet__tags">
            <span className={`mapdet__badge cat--${poi.category.replace("asteroid-", "")}`}>
              {CAT_LABEL[poi.category] ?? poi.category}
            </span>
            {poi.logged ? (
              <span className="mapdet__flag mapdet__flag--logged">Logged</span>
            ) : (
              <span className="mapdet__flag">Anchor</span>
            )}
            {poi.pvpLootable && <span className="mapdet__flag mapdet__flag--pvp">PVP</span>}
          </div>
        </div>
        <button className="icobtn" onClick={onClose} aria-label="Close" title="Close">
          ✕
        </button>
      </div>

      <div className="mapdet__coords">
        {([["X", poi.euX], ["Y", poi.euY], ["Z", poi.euZ]] as const).map(([axis, val]) => (
          <div key={axis} className="mapdet__coord">
            <span className="mapdet__axis">{axis}</span>
            <span className="mapdet__val">{val}</span>
          </div>
        ))}
      </div>

      <div className="mapdet__actions">
        <button className="btn btn--accent" onClick={copy}>
          {copied ? <IconCheck /> : <IconCopy />} {copied ? "Copied" : "Copy Waypoint"}
        </button>
        {poi.logged && (
          <button
            className="btn"
            onClick={() => {
              onDelete(poi.id);
              onClose();
            }}
          >
            <IconTrash /> Delete
          </button>
        )}
      </div>
    </div>
  );
}
