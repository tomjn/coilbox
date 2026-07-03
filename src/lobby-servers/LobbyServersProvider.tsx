import { useSetting } from "@picoframe/frame";
import { type ReactNode, useEffect, useRef } from "react";
import {
  lsDeleteCredential,
  lsGetCredential,
  lsStoreCredential,
} from "./bindings";
import { useCustomServers, useLobbyAccounts } from "./config";
import { type LegacyLobbyServerDir, planMigration } from "./migration";

/**
 * App-level provider (registered via the plugin's `Provider`) that runs the one-time
 * migration from the old `lobbyServers.directory` into the server/account model,
 * guarded by a `lobbyServers.migratedV2` flag so it runs at most once.
 */
export function LobbyServersProvider({ children }: { children: ReactNode }) {
  useLobbyServersMigration();
  return <>{children}</>;
}

function useLobbyServersMigration() {
  const [migrated, setMigrated] = useSetting("lobbyServers.migratedV2", false);
  const [oldDir] = useSetting<LegacyLobbyServerDir>("lobbyServers.directory", {
    servers: [],
  });
  const [, setCustom] = useCustomServers();
  const [, setAccounts] = useLobbyAccounts();
  const ranRef = useRef(false);

  useEffect(() => {
    if (migrated || ranRef.current) return;
    ranRef.current = true;

    const plan = planMigration(oldDir, () => crypto.randomUUID());
    setCustom({ servers: plan.customServers });
    setAccounts({ accounts: plan.accounts });

    (async () => {
      // Best-effort: a failed keychain move just means that login needs its
      // password re-entered — it does not block the rest of the migration.
      for (const move of plan.reKey) {
        try {
          const { secret } = await lsGetCredential(move.from);
          if (secret != null) {
            await lsStoreCredential({ ...move.to, secret });
            await lsDeleteCredential(move.from);
          }
        } catch (e) {
          console.warn("lobby migration: keychain move failed", move, e);
        }
      }
      setMigrated(true);
    })();
  }, [migrated, oldDir, setCustom, setAccounts, setMigrated]);
}
