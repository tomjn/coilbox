/**
 * Decode the tweak slots a battle's host has already set, without asking
 * anyone to copy them out to the paste route first (issue #2756, the case
 * issue #1280 named and left for later).
 *
 * The honest question a player has, whether this game is going to be fun or
 * is going to delete their commander, is asked in the battle room, so this
 * reads `battle.scriptTags` straight into `workshop_decode_tweak_set` rather
 * than waiting for a copy-paste. Which options are tweak slots at all comes
 * from `deliveryRoutes.ts`'s `tweakSlotOptions`, and reading their current
 * values reuses `battleOptions.ts`'s own `tweakSetEntries`, the same option
 * lookup every other field in this drawer already goes through.
 *
 * Two things this is careful about:
 *
 *  - Silence when there is nothing. Most battles set no tweak slot at all,
 *    and `tweakSetEntries` answers an empty map for one of them, which this
 *    renders as nothing rather than an empty panel or a decode that finds
 *    no slots.
 *  - Read only, and clearly so. This section only ever shows what decoded.
 *    Starting a project from it is a separate button the same way the paste
 *    drawer's own "Start a project from this" is, never the default.
 *
 * Cost is the other half of it: decoding runs Lua, and a battle room can
 * re-render on every chat line and member change. `entriesKey` is a
 * serialisation of the tweak values themselves, so the effect that calls the
 * decode command only fires when those values actually change, not on every
 * unrelated snapshot the room otherwise receives.
 */
import { Button } from "@picoframe/frame";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { ConfigOption } from "@/content/bindings";
import {
  allSlots,
  type DecodedTweakSet,
  planProjectFromDecoded,
  workshopDecodeTweakSet,
} from "@/workshop/decodeTweakSet";
import { SlotCard } from "@/workshop/pages/components/DecodedSlotCard";
import { defaultProjectName, useModProjects } from "@/workshop/project";
import { projectPath } from "@/workshop/routes";
import { tweakSetEntries } from "./battleOptions";

type Phase =
  | { state: "idle" }
  | { state: "decoding" }
  | { state: "done"; set: DecodedTweakSet }
  | { state: "failed"; message: string };

export function BattleTweakDecodeSection({
  gameName,
  modOptionsSchema,
  scriptTags,
}: {
  gameName: string;
  modOptionsSchema: ConfigOption[];
  scriptTags: Record<string, string>;
}) {
  const navigate = useNavigate();
  const { projects, createProject } = useModProjects();
  const entries = tweakSetEntries(modOptionsSchema, scriptTags);
  const entriesKey = JSON.stringify(entries);
  const [phase, setPhase] = useState<Phase>({ state: "idle" });

  // `entries` is rebuilt every render. `entriesKey` is the real dependency,
  // and only changes when the battle's tweak values actually do, which is
  // what keeps this from re-decoding on every unrelated battle update.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (Object.keys(entries).length === 0) {
      setPhase({ state: "idle" });
      return;
    }
    let cancelled = false;
    setPhase({ state: "decoding" });
    workshopDecodeTweakSet({ entries })
      .then((set) => {
        if (!cancelled) setPhase({ state: "done", set });
      })
      .catch((error) => {
        if (!cancelled) {
          setPhase({
            state: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [entriesKey]);

  if (Object.keys(entries).length === 0) return null;

  const plan =
    phase.state === "done" ? planProjectFromDecoded(phase.set) : null;
  const nothingToStart =
    !plan || (plan.clones.length === 0 && plan.readOnlyLua.length === 0);

  function startProject() {
    if (!plan) return;
    const project = createProject({
      name: defaultProjectName(gameName, projects),
      gameName,
      ...(plan.clones.length > 0
        ? {
            edits: {
              overrides: {},
              clones: Object.fromEntries(
                plan.clones.map((clone) => [clone.key, clone]),
              ),
              menus: {},
              text: {},
              disabled: [],
            },
          }
        : {}),
      ...(plan.readOnlyLua.length > 0 ? { readOnlyLua: plan.readOnlyLua } : {}),
    });
    navigate(projectPath(project.id));
  }

  return (
    <section>
      <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        Tweak slots
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        What this battle already has set, decoded back to Lua. Read only,
        nothing here changes what the host set.
      </p>

      {phase.state === "decoding" && (
        <p className="text-xs text-muted-foreground">Decoding…</p>
      )}
      {phase.state === "failed" && (
        <p className="text-xs text-destructive">{phase.message}</p>
      )}
      {phase.state === "done" && (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {allSlots(phase.set).map((slot, index) => (
              // A decode result is stable once it lands and slots do not
              // reorder under the user's cursor.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              <SlotCard key={index} slot={slot} />
            ))}
          </ul>
          {!nothingToStart && (
            <Button size="sm" variant="secondary" onClick={startProject}>
              Start a project from this
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
