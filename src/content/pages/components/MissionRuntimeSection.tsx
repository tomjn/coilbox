import { Button, cn } from "@picoframe/frame";
import { ChevronRight, Download, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  type RuntimeMarker,
  scenarioRuntimeInstall,
  scenarioRuntimeStatus,
} from "@/scenario/bindings";
import {
  type Capability,
  capabilityNote,
  runtimeCapabilities,
  supportedCount,
} from "@/scenario/capabilities";
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
      return installed
        ? `This game vendors runtime version ${installed.version}. This build of coilbox has no runtime of its own to measure it against.`
        : "This build of coilbox has no mission runtime to install.";
    case "missing":
      return "Coilbox found no readable runtime marker in this game, so it cannot play scenarios yet. Installing writes coilbox's luarules, luaui and missions folders into the game folder.";
    case "newer":
      return `This game vendors runtime version ${installed?.version}, newer than the version ${available?.version} coilbox ships. Installing would take it backwards.`;
    default:
      return `This game vendors runtime version ${installed?.version}. Coilbox ships version ${available?.version}.`;
  }
}

/**
 * The mission format each side speaks. A mismatch matters more than the runtime
 * version does: it is the number that decides whether the game can read a
 * mission this coilbox compiled at all.
 */
function formatNote(
  installed: RuntimeMarker | null,
  available: RuntimeMarker | null,
): string | null {
  if (!installed) return null;
  if (available && installed.schemaVersion !== available.schemaVersion)
    return `It reads mission format ${installed.schemaVersion}, and coilbox compiles format ${available.schemaVersion}. A scenario compiled here may not load until those match.`;
  return `It reads mission format ${installed.schemaVersion}.`;
}

/** What the capability list is counting, above the list itself. */
function capabilityHeadline(
  installed: RuntimeMarker | null,
  conditions: Capability[],
  actions: Capability[],
): string {
  if (!installed)
    return `Installing adds ${conditions.length} conditions and ${actions.length} actions`;
  return `Supports ${supportedCount(conditions)} of ${conditions.length} conditions and ${supportedCount(actions)} of ${actions.length} actions`;
}

function CapabilityList({
  heading,
  items,
  installed,
  available,
}: {
  heading: string;
  items: Capability[];
  installed: RuntimeMarker | null;
  available: RuntimeMarker | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {heading}
      </h3>
      <ul className="flex flex-col gap-1">
        {items.map((c) => {
          const note = capabilityNote(c.status, installed, available);
          return (
            <li key={c.name} className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "font-mono text-xs",
                  c.status === "added" && "text-muted-foreground",
                )}
              >
                {c.name}
              </span>
              {note && (
                <Badge
                  variant={c.status === "extra" ? "secondary" : "outline"}
                  className="text-[10px]"
                >
                  {note}
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Installing coilbox's mission runtime into a game, and what the installed one
 * supports, so a player knows before building a scenario which triggers this
 * game can actually run.
 *
 * Only a loose `.sdd` gets this: adoption means the game vendors `luarules/`,
 * `luaui/` and `missions/`, which coilbox cannot write into a packaged
 * `.sd7`/`.sdz`. Those games are offered the test mutator instead (issue #754).
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

  const { conditions, actions } = runtimeCapabilities(installed, available);
  const note = formatNote(installed, available);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Mission runtime</h2>
      <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-prose text-sm text-muted-foreground">
            {summary(state, installed, available)}
            {note && ` ${note}`}
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
        {conditions.length + actions.length > 0 && (
          <Collapsible className="border-t border-border/50 pt-3">
            <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-1 text-left text-sm text-muted-foreground hover:text-foreground">
              <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
              {capabilityHeadline(installed, conditions, actions)}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <CapabilityList
                  heading="Conditions"
                  items={conditions}
                  installed={installed}
                  available={available}
                />
                <CapabilityList
                  heading="Actions"
                  items={actions}
                  installed={installed}
                  available={available}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
      {error && <p className="break-words text-sm text-destructive">{error}</p>}
    </section>
  );
}
