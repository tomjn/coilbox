import { useSetting } from "@picoframe/frame";
import { type ReactNode, useEffect, useRef } from "react";
import {
  lsDeleteCredential,
  lsGetCredential,
  lsStoreCredential,
} from "./bindings";
import { useCustomServers, useLastLogin, useLobbyAccounts } from "./config";
import {
  type LegacyLobbyServerDir,
  planBarTlsRemap,
  planMigration,
} from "./migration";

/**
 * App-level provider (registered via the plugin's `Provider`) that runs the one-time
 * settings migrations, each guarded by its own flag so it runs at most once.
 */
export function LobbyServersProvider({ children }: { children: ReactNode }) {
  useLobbyServersMigration();
  useBarTlsMigration();
  return <>{children}</>;
}

function useLobbyServersMigration() {
  // Assumes the settings store is fully hydrated synchronously before first render:
  // the effect reads `lobbyServers.directory` once and latches `migratedV2`/`ranRef`
  // after a single pass, so an async-hydrating store would run against the empty
  // default and flip the flag -> silent data loss. Safe here because `main.tsx` awaits
  // `createTauriSettingsStorage` (synchronous `get()`) before `render` — non-local.
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

/**
 * Move logins off the retired plaintext BAR built-in onto the SSL one, once, guarded
 * by `lobbyServers.migratedBarTls`.
 *
 * Safe to run alongside the v2 migration above despite both writing accounts: an
 * install still holding a legacy directory has no accounts yet for this to rewrite,
 * and `planMigration` already lands those rows on the SSL entry itself.
 */
function useBarTlsMigration() {
  const [migrated, setMigrated] = useSetting(
    "lobbyServers.migratedBarTls",
    false,
  );
  const [accountsCfg, setAccounts] = useLobbyAccounts();
  const [lastLogin, setLastLogin] = useLastLogin();
  const ranRef = useRef(false);

  useEffect(() => {
    if (migrated || ranRef.current) return;
    ranRef.current = true;

    const plan = planBarTlsRemap(accountsCfg.accounts, lastLogin);
    if (!plan.changed) {
      setMigrated(true);
      return;
    }
    setAccounts({ accounts: plan.accounts });
    setLastLogin(plan.lastLogin);

    (async () => {
      // Best-effort, as above: a failed move costs that login its saved password,
      // not the rest of the migration.
      for (const move of plan.reKey) {
        try {
          const { secret } = await lsGetCredential(move.from);
          if (secret != null) {
            await lsStoreCredential({ ...move.to, secret });
            await lsDeleteCredential(move.from);
          }
        } catch (e) {
          console.warn("bar TLS remap: keychain move failed", move, e);
        }
      }
      setMigrated(true);
    })();
  }, [
    migrated,
    accountsCfg,
    lastLogin,
    setAccounts,
    setLastLogin,
    setMigrated,
  ]);
}
