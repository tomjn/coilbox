import { ChevronRight, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ConfigOption } from "@/content/bindings";
import { deliverySlots } from "@/multiplayer/battle/tweakDelivery";
import { barSlotFit, workshopPackBarSlots } from "@/workshop/barPack";
import { deliveryRoutes } from "@/workshop/deliveryRoutes";
import { type ModProject, useModProjects } from "@/workshop/project";

/**
 * Applying a unit tweak project on top of whatever options are already set.
 *
 * Shared by both preset sheets, reached from a row above the preset list. A
 * project is not a preset and does not want to be one: a preset describes a
 * setup, and this changes what the units in it do, so it layers over the
 * options a preset just wrote rather than competing with them.
 *
 * A game with tweak slots takes the project as slot values. One without takes
 * it as a mutator archive that depends on it, which is a game of its own but
 * changes nothing else, so the map, roster and options still mean what they
 * meant. Only Singleplayer can take that second route: the archive is on this
 * machine alone, so a room would leave everybody else unable to launch.
 */
/**
 * The projects this surface could apply to this game, and why it could not.
 *
 * Read by the row as well as the panel, so the row can say up front that there
 * is nothing behind it rather than opening onto an explanation. Two ways to
 * have nothing: the game has no route for a project here, or it has one and you
 * have written no projects against that game.
 */
export function usePresetTweaks(
  gameName: string,
  modOptionsSchema: ConfigOption[],
  /** Whether this surface can fall back to a mutator archive. */
  canMutator: boolean,
): { projects: ModProject[]; unavailable: string | null } {
  const { projects } = useModProjects();
  const mine = useMemo(
    () => projects.filter((p) => p.gameName === gameName),
    [projects, gameName],
  );
  const slots =
    deliveryRoutes(modOptionsSchema, gameName).find(
      (r) => r.route === "tweak-slots",
    )?.available ?? false;

  if (!slots && !canMutator)
    return {
      projects: mine,
      unavailable: `${gameName} has no tweak slots to carry a project here`,
    };
  if (mine.length === 0)
    return { projects: mine, unavailable: `No projects for ${gameName} yet` };
  return { projects: mine, unavailable: null };
}

export function PresetTweaksView({
  gameName,
  modOptionsSchema,
  disabled,
  onApply,
  onApplyMutator,
}: {
  /** The game the setup or room is on. A project is written against one game. */
  gameName: string;
  modOptionsSchema: ConfigOption[];
  disabled?: boolean;
  /** The packed slots, keyed by bare mod option name (`tweakdefs`,
   *  `tweakunits3`), for the caller to write however its surface writes. */
  onApply: (slots: Record<string, string>, project: ModProject) => void;
  /**
   * Apply by building a mutator archive and playing that instead, for a game
   * with no slots to carry Lua.
   *
   * Singleplayer only. The archive lives on this machine, so a room full of
   * people who do not have it cannot launch, which is why the slot route is the
   * only one a battle offers. Absent on the surfaces that cannot take it.
   */
  onApplyMutator?: (project: ModProject) => Promise<void>;
}) {
  const [packing, setPacking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { projects: mine } = usePresetTweaks(
    gameName,
    modOptionsSchema,
    !!onApplyMutator,
  );
  const slotsAvailable =
    deliveryRoutes(modOptionsSchema, gameName).find(
      (r) => r.route === "tweak-slots",
    )?.available ?? false;

  async function apply(project: ModProject) {
    setError(null);
    setPacking(project.id);
    try {
      // A game with no slots takes the mutator route instead, where there is
      // one to take. Nothing about the project changes, only how it is carried.
      if (!slotsAvailable) {
        if (!onApplyMutator) return;
        await onApplyMutator(project);
        return;
      }
      const pack = await workshopPackBarSlots({ project });
      const fit = barSlotFit(pack, modOptionsSchema);
      const missing = pack.oversized.length + pack.unplaced.length;
      if (missing > 0 || !fit.fits) {
        setError(
          `This project does not pack into the slots ${gameName} has, so none of it was applied. Open it in the workshop and use Package to see which edits will not fit.`,
        );
        return;
      }
      const slots: Record<string, string> = {};
      for (const slot of deliverySlots(pack)) slots[slot.name] = slot.value;
      onApply(slots, project);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPacking(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="border-b border-border/60 px-5 py-3 text-xs text-muted-foreground">
        Applied over whatever the options already say, so a preset first and a
        project after gives you both.
      </p>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <ul className="flex flex-col gap-2">
          {mine.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => apply(p)}
                disabled={disabled || packing !== null}
                className="flex w-full min-w-0 items-center gap-3 rounded-lg border border-border/50 bg-card p-3 text-left transition-colors hover:border-border hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {p.name}
                  </span>
                  {p.description && (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {p.description}
                    </span>
                  )}
                </span>
                {packing === p.id ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
