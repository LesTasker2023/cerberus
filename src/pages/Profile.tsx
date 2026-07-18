import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DiscordSession } from "../hooks/useAuth";

/** Cerberus player profile — the pilot's clan identity, roles and session, plus
 *  account actions. Backed by the Discord clan session. */
export function Profile({
  session,
  onLogout,
}: {
  session: DiscordSession | null | undefined;
  onLogout: () => void;
}) {
  if (!session) {
    return <div className="profile profile--empty">No pilot signed in.</div>;
  }

  const expires = new Date(session.expires_at * 1000);

  return (
    <div className="profile">
      <header className="profile__head">
        {session.avatar_url ? (
          <img className="profile__av" src={session.avatar_url} alt="" />
        ) : (
          <span className="profile__av profile__av--none" />
        )}
        <div className="profile__id">
          <h2 className="profile__name">{session.display_name}</h2>
          <span className="profile__handle">@{session.username}</span>
        </div>
        <span className={`profile__badge ${session.is_member ? "profile__badge--on" : ""}`}>
          {session.is_member ? "Clan member" : "Not a member"}
        </span>
      </header>

      <div className="profile__cards">
        <Card label="Access">{session.has_required_role ? "Granted" : "Restricted"}</Card>
        <Card label="Discord ID">{session.user_id}</Card>
        <Card label="Session expires">{expires.toLocaleString()}</Card>
      </div>

      <section className="profile__sec">
        <h3 className="profile__h">Clan roles</h3>
        {session.roles.length ? (
          <div className="profile__roles">
            {session.roles.map((r) => (
              <span key={r} className="profile__role">
                {r}
              </span>
            ))}
          </div>
        ) : (
          <p className="profile__dim">No roles assigned.</p>
        )}
      </section>

      <div className="profile__actions">
        <button
          className="btn btn--ghost"
          onClick={() => openUrl(`https://discord.com/users/${session.user_id}`)}
        >
          View on Discord
        </button>
        <button className="btn btn--ghost profile__signout" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="profile__card">
      <span className="profile__card-l">{label}</span>
      <span className="profile__card-v">{children}</span>
    </div>
  );
}
