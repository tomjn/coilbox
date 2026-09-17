import type { ReactNode } from "react";
import { isServerAdmin } from "./serverAdmin";
import { useMultiplayer } from "./store";
import { useServerAdminKey } from "./useServerAdminKey";

/**
 * Whether the connection the Server admin page is acting on
 * (`useServerAdminKey`) is an uberserver admin rather than only a moderator
 * (issue #2776). The gate later admin-only sections (issues #2785-#2788) use,
 * so a moderator who could only ever be refused never sees the control at
 * all, rather than seeing it and being told "Insufficient rights."
 */
export function useIsServerAdmin(): boolean {
  const { connections } = useMultiplayer();
  const [serverKey] = useServerAdminKey();
  return isServerAdmin(connections, serverKey);
}

/**
 * Renders `children` for an admin and nothing for a moderator, on the
 * connection the Server admin page is acting on. A thin wrapper over
 * {@link useIsServerAdmin} for a section that has nothing else to decide with
 * the result.
 */
export function AdminOnly({ children }: { children: ReactNode }) {
  return useIsServerAdmin() ? children : null;
}
