import { NavGate } from "@picoframe/frame";
import { LoginPanel } from "../LobbyStatusButton";
import { useMpDisconnected } from "../navPredicates";

/**
 * The multiplayer login screen (route `/lobby`, labelled "Login"). Shown only
 * while logged out: `NavGate` redirects to Battles the moment a connection goes
 * live, which is also how "log in → land on Battles" is delivered. The body reuses
 * the shared LoginPanel (identical to the topbar popover) so connect/reconnect
 * logic lives in one place. Battle chat and browsing live on Chat/Battles.
 *
 * Default-exported for the frame's lazy route convention.
 */
export default function LobbyPage() {
  return (
    <NavGate use={useMpDisconnected} redirectTo="/battles">
      <main className="flex min-h-full flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-lg border border-border p-6">
          <LoginPanel onNavigate={() => {}} />
        </div>
      </main>
    </NavGate>
  );
}
