import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Rock {
  name: string;
  category: string;
  eu_x: number;
  eu_y: number;
  eu_z: number;
}

type State = "idle" | "busy" | "ok" | "err";

const TYPE_SHORT: Record<string, string> = {
  "asteroid-m": "M",
  "asteroid-c": "C",
  "asteroid-f": "F",
  "asteroid-s": "S",
  "asteroid-nd": "ND",
  "asteroid-scrap": "SC",
  station: "ST",
};

/** "L8 M-type Asteroid II" + asteroid-m → "M-II"; drops the size if not roman. */
function shortTag(r: Rock): string {
  const type = TYPE_SHORT[r.category] ?? "?";
  const last = r.name.trim().split(/\s+/).pop() ?? "";
  return /^[IVXL]+$/i.test(last) ? `${type}-${last.toUpperCase()}` : type;
}

/** Tiny always-on-top pill: a drag grip + one LOG button. Right-click to hide. */
export function Panel() {
  const [state, setState] = useState<State>("idle");
  const [tag, setTag] = useState("");
  const [last, setLast] = useState("");

  const settle = (s: "ok" | "err") => {
    setState(s);
    setTimeout(() => setState("idle"), s === "ok" ? 1600 : 1600);
  };

  const onLogged = (r: Rock) => {
    setTag(shortTag(r));
    setLast(`${r.name} · ${r.eu_x}, ${r.eu_y}, ${r.eu_z}`);
    settle("ok");
  };

  const log = useCallback(async () => {
    setState("busy");
    try {
      onLogged(await invoke<Rock>("capture_and_log"));
    } catch (e) {
      setLast(String(e));
      settle("err");
    }
  }, []);

  // Reflect logs fired via the Ctrl+Shift+C hotkey too.
  useEffect(() => {
    const a = listen<Rock>("asteroid:logged", (e) => onLogged(e.payload));
    const b = listen<string>("capture:error", (e) => {
      setLast(e.payload);
      settle("err");
    });
    return () => {
      a.then((off) => off());
      b.then((off) => off());
    };
  }, []);

  const glyph =
    state === "busy" ? "···" : state === "ok" ? `✓ ${tag}` : state === "err" ? "✕" : "LOG";

  return (
    <div className="mini" onContextMenu={(e) => (e.preventDefault(), getCurrentWindow().hide())}>
      <div className="mini__grip" data-tauri-drag-region title="Drag · right-click to hide">
        ⠿
      </div>
      <button
        className={`mini__btn mini__btn--${state}`}
        onClick={log}
        disabled={state === "busy"}
        title={last || "Log rock at position"}
      >
        {glyph}
      </button>
    </div>
  );
}
