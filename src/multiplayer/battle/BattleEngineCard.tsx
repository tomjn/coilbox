import type { EngineMatch } from "./engineMatch";

/**
 * The engine the host asked for beside the one this machine would launch. The
 * host's engine turns away any other version and says why only in its own log,
 * so both are named here before the game starts.
 */
export function BattleEngineCard({ match }: { match: EngineMatch }) {
  const { verdict, hostLabel, mineLabel } = match;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-card p-4 text-sm">
      <span className="font-semibold">Engine</span>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Host</dt>
        <dd className="break-words">{hostLabel ?? "Not given by the lobby"}</dd>
        <dt className="text-muted-foreground">Yours</dt>
        <dd className="break-words">{mineLabel ?? "None"}</dd>
      </dl>
      {verdict === "mismatch" && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400">
          You do not have the host's engine, so the host will refuse your
          connection. Install {hostLabel} in Settings, Engines.
        </p>
      )}
      {verdict === "unverified" && (
        <p className="text-muted-foreground">
          Your engine has not reported its version yet, so this is its folder
          name. It may still be the host's version.
        </p>
      )}
    </div>
  );
}
