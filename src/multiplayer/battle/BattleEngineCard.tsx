import type { PlayTarget } from "@/play/config";
import { engineMatch } from "./engineMatch";

/**
 * The engine the host asked for beside the one this machine would launch. The
 * engine turns away any other version without telling the player why, so a
 * difference is called out here before the game starts.
 */
export function BattleEngineCard({
  engine,
  version,
  target,
}: {
  engine: string;
  version: string;
  target: PlayTarget | null;
}) {
  const { verdict, hostLabel, mineLabel } = engineMatch(
    { engine, version },
    target,
  );

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
          Your engine is not the version the host asked for, so the host will
          refuse your connection. Install {hostLabel} and pick it in Settings,
          Engines.
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
