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
 * Only the tweak-slot route is on offer here. A project's other route is a
 * mutator archive, which is a game of its own rather than a value in a slot,
 * so it cannot be laid over a setup at all and belongs where it already is, in
 * the workshop. A game declaring no slots is told that rather than shown an
 * empty list.
 */
export function PresetTweaksView({
  gameName,
  modOptionsSchema,
  disabled,
  onApply,
}: {
  /** The game the setup or room is on. A project is written against one game. */
  gameName: string;
  modOptionsSchema: ConfigOption[];
  disabled?: boolean;
  /** The packed slots, keyed by bare mod option name (`tweakdefs`,
   *  `tweakunits3`), for the caller to write however its surface writes. */
  onApply: (slots: Record<string, string>, project: ModProject) => void;
}) {
  const { projects } = useModProjects();
  const [packing, setPacking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mine = useMemo(
    () => projects.filter((p) => p.gameName === gameName),
    [projects, gameName],
  );
  const route = deliveryRoutes(modOptionsSchema, gameName).find(
    (r) => r.route === "tweak-slots",
  );

  async function apply(project: ModProject) {
    setError(null);
    setPacking(project.id);
    try {
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

        {route && !route.available ? (
          // Not the route's own detail line, which ends by pointing at the
          // mutator route "above" and there is no route list here to point at.
          <p className="py-8 text-center text-sm text-muted-foreground">
            {gameName} declares no tweakdefs or tweakunits options, so there is
            no slot here to carry a project. Test it in the workshop instead,
            which builds a mutator archive every game can read.
          </p>
        ) : mine.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No unit tweak projects for {gameName} yet. Make one in the workshop.
          </p>
        ) : (
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
        )}
      </div>
    </div>
  );
}
