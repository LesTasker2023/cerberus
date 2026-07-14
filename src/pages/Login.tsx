import { WindowControls } from "../components/WindowControls";
import type { DiscordSession } from "../hooks/useAuth";

/** Full-window clan gate: sign in with Discord, or an access-denied state for
 *  users who authenticate but aren't clan members. */
export function Login({
  session,
  busy,
  error,
  onLogin,
  onLogout,
}: {
  session: DiscordSession | null | undefined;
  busy: boolean;
  error: string | null;
  onLogin: () => void;
  onLogout: () => void;
}) {
  const denied = session != null; // signed in, but failed the membership/role gate
  const reason =
    session && !session.is_member
      ? "You're not a member of the clan Discord server."
      : session && !session.has_required_role
        ? "Your account is missing the required clan role."
        : null;

  return (
    <div className="app app--stack">
      <header className="titlebar" data-tauri-drag-region>
        <span className="brand brand--static">
          <span className="brand__diamond" />
          CERBERUS
        </span>
        <div className="titlebar__drag" data-tauri-drag-region />
        <WindowControls />
      </header>

      <main className="content">
        <div className="login">
          <div className="login__card">
            <div className="login__crest">
              <span className="brand__diamond" />
            </div>
            <h1 className="login__title">CERBERUS</h1>
            <p className="login__sub">Clan access — sign in with Discord to continue.</p>

            {session === undefined ? (
              <div className="login__status">Checking session…</div>
            ) : (
              <>
                {denied && reason && (
                  <div className="login__denied">
                    <b>Access denied.</b> {reason}
                    {session && (
                      <div className="login__who">Signed in as {session.display_name}</div>
                    )}
                  </div>
                )}

                <button className="login__btn" onClick={onLogin} disabled={busy}>
                  <DiscordMark />
                  {busy
                    ? "Waiting for Discord…"
                    : denied
                      ? "Try another account"
                      : "Sign in with Discord"}
                </button>

                {denied && (
                  <button className="login__link" onClick={onLogout} disabled={busy}>
                    Sign out
                  </button>
                )}

                {busy && (
                  <div className="login__hint">
                    Finish signing in on the page that opened in your browser, then come back.
                  </div>
                )}
                {error && <div className="login__error">{error}</div>}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function DiscordMark() {
  return (
    <svg viewBox="0 0 24 18" width="18" height="14" fill="currentColor" aria-hidden>
      <path d="M20.3 1.6A19.8 19.8 0 0 0 15.4.1l-.3.5a15 15 0 0 1 4 1.3 13.7 13.7 0 0 0-11.9 0 15 15 0 0 1 4-1.3L10.9.1A19.8 19.8 0 0 0 6 1.6C2.8 6.3 1.9 10.9 2.3 15.4a20 20 0 0 0 6 3l.8-1.3c-.7-.3-1.4-.6-2-1l.5-.4a14.3 14.3 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l.8 1.3a20 20 0 0 0 6-3c.5-5.2-.9-9.8-3.6-13.8ZM9 12.7c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" />
    </svg>
  );
}
