import { getCurrentWindow } from "@tauri-apps/api/window";

const win = getCurrentWindow();

/** Custom min / maximize / close controls for the borderless window. */
export function WindowControls() {
  return (
    <div className="wc">
      <button className="wc__btn" onClick={() => win.minimize()} aria-label="Minimize">
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
          <line x1="1.5" y1="6" x2="9.5" y2="6" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      <button className="wc__btn" onClick={() => win.toggleMaximize()} aria-label="Maximize">
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
          <rect x="2" y="2" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      <button className="wc__btn wc__btn--close" onClick={() => win.close()} aria-label="Close">
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
          <path d="M2 2 L9 9 M9 2 L2 9" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}
