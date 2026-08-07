import { Button, cn } from "@picoframe/frame";
import { ChevronRight, Download, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { isGeneratedGame } from "@/lib/generatedGames";
import {
  type RuntimeMarker,
  scenarioDeleteMission,
  scenarioListMissions,
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
import { type GameMission, gameMissions } from "@/scenario/missions";
import { mutatorOffer } from "@/scenario/offer";
import { useScenarios } from "@/scenario/scenarios";
import type { GameItem } from "../../bindings";
import { isSdd } from "../../format";

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** What the button says, per {@link runtimeInstallState}. */
const LABEL = {
  unavailable: "Mission runtime unavailable",
  missing: "Install the mission runtime",
  broken: "Repair the mission runtime",
  outdated: "Update the mission runtime",
  current: "Reinstall the mission runtime",
  newer: "Replace with coilbox's mission runtime",
} as const;

/** Where this game stands, in a sentence. */
function summary(
  state: RuntimeInstallState,
  installed: RuntimeMarker | null,
  available: RuntimeMarker | null,
  installedError: string | null,
): string {
  switch (state) {
    case "unavailable":
      return installed
        ? `This game vendors runtime version ${installed.version}. This build of coilbox has no runtime of its own to measure it against.`
        : "This build of coilbox has no mission runtime to install.";
    case "missing":
      return "Coilbox found no runtime marker in this game, so it cannot play scenarios yet. Installing writes coilbox's luarules, luaui and missions folders into the game folder.";
    case "broken":
      // The error names the file and the line itself, so this does not repeat
      // the path it used to spell out (issue #915).
      return `This game has a runtime marker, but it would not load: ${installedError}. Until that is fixed the engine will not read it either, so coilbox cannot tell what this runtime supports. Repairing overwrites it with the version ${available?.version} coilbox ships.`;
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

/** The two capability lists behind one collapsible line that counts them. */
function CapabilityPanel({
  headline,
  conditions,
  actions,
  installed,
  available,
}: {
  headline: string;
  conditions: Capability[];
  actions: Capability[];
  installed: RuntimeMarker | null;
  available: RuntimeMarker | null;
}) {
  if (conditions.length + actions.length === 0) return null;
  return (
    <Collapsible className="border-t border-border/50 pt-3">
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-1 text-left text-sm text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        {headline}
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
  );
}

/** One mission folder: what it is called, and where it came from. */
function MissionRow({
  mission,
  busy,
  onRemove,
}: {
  mission: GameMission;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className={cn("truncate text-sm", !mission.name && "font-mono")}>
          {mission.name ?? mission.id}
        </span>
        {mission.ours && !mission.name && (
          <Badge variant="outline" className="text-[10px]">
            no scenario here any more
          </Badge>
        )}
        {!mission.ours && (
          <Badge variant="secondary" className="text-[10px]">
            the game's own
          </Badge>
        )}
      </div>
      {mission.ours && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onRemove}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
          Remove
        </Button>
      )}
    </li>
  );
}

/**
 * The missions coilbox has written into this game, and a way to take them back
 * out (issue #814).
 *
 * Launching a scenario here writes `missions/<scenario id>/` and nothing has
 * ever removed it, so a game a player tests against collects a folder per
 * scenario, and one whose scenario was deleted since is still launchable by
 * hand. The game's own missions are listed beside them but carry no Remove
 * button: they are the game's content, and coilbox did not put them there.
 */
function WrittenMissions({ root }: { root: string }) {
  const { scenarios: loaded } = useScenarios();
  const scenarios = loaded.map((l) => l.scenario);
  const [folders, setFolders] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    scenarioListMissions({ root })
      .then(({ missions }) => {
        if (!cancelled) setFolders(missions);
      })
      .catch(() => {
        // A game whose missions cannot be listed simply shows none. There is
        // nothing here a player has to be told about.
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

  const missions = gameMissions(folders, scenarios);
  if (missions.length === 0) return null;

  const ours = missions.filter((m) => m.ours).length;
  const headline =
    ours > 0
      ? `Coilbox has written ${ours} mission${ours === 1 ? "" : "s"} into this game`
      : `This game ships ${missions.length} mission${missions.length === 1 ? "" : "s"} of its own`;

  const remove = async (mission: GameMission) => {
    setRemoving(mission.id);
    try {
      await scenarioDeleteMission({ root, scenarioId: mission.id });
      setFolders((current) => current.filter((id) => id !== mission.id));
      toast.success(`Removed ${mission.name ?? mission.id} from the game.`);
    } catch (e) {
      toast.error(msg(e));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Collapsible className="border-t border-border/50 pt-3">
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-1 text-left text-sm text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        {headline}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          Testing a scenario here leaves its compiled mission in the game
          folder. Removing one takes the folder and its dialogue clips, and
          nothing else. The mission runtime stays, and testing that scenario
          again writes it back.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {missions.map((mission) => (
            <MissionRow
              key={mission.id}
              mission={mission}
              busy={removing === mission.id}
              onRemove={() => remove(mission)}
            />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * What a packaged `.sd7`/`.sdz` gets in place of the install action: why the
 * runtime cannot go into it, and the test mutator coilbox generates instead.
 *
 * The capabilities are listed against the runtime coilbox ships, because that is
 * the one the mutator carries, so every type it declares is one a scenario
 * tested here can use.
 */
function PackagedOffer({
  gameName,
  available,
}: {
  gameName: string;
  available: RuntimeMarker | null;
}) {
  const { reason, offer, limit } = mutatorOffer(gameName, available);
  const { conditions, actions } = runtimeCapabilities(available, available);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Mission runtime</h2>
      <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-3">
        <div className="flex max-w-prose flex-col gap-2 text-sm text-muted-foreground">
          <p>{reason}</p>
          <p>{offer}</p>
          {limit && <p>{limit}</p>}
        </div>
        <CapabilityPanel
          headline={`The test mutator brings ${conditions.length} conditions and ${actions.length} actions`}
          conditions={conditions}
          actions={actions}
          installed={available}
          available={available}
        />
      </div>
    </section>
  );
}

/**
 * Installing coilbox's mission runtime into a game, and what the installed one
 * supports, so a player knows before building a scenario which triggers this
 * game can actually run.
 *
 * Only a loose `.sdd` can be installed into: adoption means the game vendors
 * `luarules/`, `luaui/` and `missions/`, which coilbox cannot write into a
 * packaged `.sd7`/`.sdz`. A packaged game gets {@link PackagedOffer} instead.
 *
 * Coilbox's own generated games get neither (issue #817). They are loose
 * `.sdd`s, so this used to offer to install a runtime into one, but coilbox
 * rewrites the whole folder on the next test launch and puts the runtime it
 * ships there itself. Nothing here is a player's to maintain.
 */
export function MissionRuntimeSection({ game }: { game: GameItem }) {
  const archive = game.primaryArchive;
  const root = archive.path;
  const generated = isGeneratedGame(archive.name);
  const loose = isSdd(archive) && !!root;
  const [installed, setInstalled] = useState<RuntimeMarker | null>(null);
  const [installedError, setInstalledError] = useState<string | null>(null);
  const [available, setAvailable] = useState<RuntimeMarker | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!root || generated) return;
    try {
      const status = await scenarioRuntimeStatus({ root });
      setInstalled(status.installed);
      setInstalledError(status.installedError);
      setAvailable(status.available);
    } catch (e) {
      setError(msg(e));
    }
  }, [root, generated]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (generated || !root) return null;
  if (!loose)
    return <PackagedOffer gameName={game.name} available={available} />;

  const state = runtimeInstallState(installed, available, installedError);

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await scenarioRuntimeInstall({ root });
      setInstalled(result.installed);
      setInstalledError(null);
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
            {summary(state, installed, available, installedError)}
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
        <CapabilityPanel
          headline={capabilityHeadline(installed, conditions, actions)}
          conditions={conditions}
          actions={actions}
          installed={installed}
          available={available}
        />
        <WrittenMissions root={root} />
      </div>
      {error && <p className="break-words text-sm text-destructive">{error}</p>}
    </section>
  );
}
