import { Button } from "@picoframe/frame";
import { Download, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  type RuntimeMarker,
  scenarioRuntimeInstall,
  scenarioRuntimeStatus,
} from "@/scenario/bindings";
import {
  type RuntimeInstallState,
  runtimeInstallState,
} from "@/scenario/install";
import type { Archive } from "../../bindings";
import { isSdd } from "../../format";

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** What the button says, per {@link runtimeInstallState}. */
const LABEL = {
  unavailable: "Mission runtime unavailable",
  missing: "Install the mission runtime",
  outdated: "Update the mission runtime",
  current: "Reinstall the mission runtime",
  newer: "Replace with coilbox's mission runtime",
} as const;

/** Where this game stands, in a sentence. */
function summary(
  state: RuntimeInstallState,
  installed: RuntimeMarker | null,
  available: RuntimeMarker | null,
): string {
  switch (state) {
    case "unavailable":
      return "This build of coilbox has no mission runtime to install.";
    case "missing":
      return "This game has not adopted the runtime, so it cannot play scenarios yet. Installing writes coilbox's luarules, luaui and missions folders into the game folder.";
    case "newer":
      return `This game vendors runtime version ${installed?.version}, newer than the version ${available?.version} coilbox ships. Installing would take it backwards.`;
    default:
      return `This game vendors runtime version ${installed?.version}. Coilbox ships version ${available?.version}.`;
  }
}

/**
 * Installing coilbox's mission runtime into a game, so it can play scenarios.
 *
 * Only a loose `.sdd` gets this: adoption means the game vendors `luarules/`,
 * `luaui/` and `missions/`, which coilbox cannot write into a packaged
 * `.sd7`/`.sdz`. Those games are offered the test mutator instead (issue #754),
 * and what an installed runtime supports is shown here too (issue #751).
 */
export function MissionRuntimeSection({ archive }: { archive: Archive }) {
  const root = archive.path;
  const loose = isSdd(archive) && !!root;
  const [installed, setInstalled] = useState<RuntimeMarker | null>(null);
  const [available, setAvailable] = useState<RuntimeMarker | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!root) return;
    try {
      const status = await scenarioRuntimeStatus({ root });
      setInstalled(status.installed);
      setAvailable(status.available);
    } catch (e) {
      setError(msg(e));
    }
  }, [root]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!loose || !root) return null;

  const state = runtimeInstallState(installed, available);

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await scenarioRuntimeInstall({ root });
      setInstalled(result.installed);
      toast.success(
        `Mission runtime version ${result.installed.version} installed, ${result.files.length} files.`,
      );
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Mission runtime</h2>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 bg-card p-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          {summary(state, installed, available)}
        </p>
        {state !== "unavailable" && (
          <Button
            type="button"
            size="sm"
            variant={state === "current" ? "outline" : "default"}
            disabled={busy}
            onClick={install}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {LABEL[state]}
          </Button>
        )}
      </div>
      {error && <p className="break-words text-sm text-destructive">{error}</p>}
    </section>
  );
}
