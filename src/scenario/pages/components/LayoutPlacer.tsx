/**
 * Pick a layout, pick a team, click the map (issues #1327, #1450).
 *
 * The controls the Layouts mode puts beside the mode strip. They are here
 * rather than in `modes.tsx` because the picker has to say what it is about to
 * do to the document before it does it: a layout out of the library is for one
 * game and names units by their internal name, so an author dropping somebody
 * else's compound into their mission is owed the same answer the library import
 * gives, and `@/blueprint/arrival.ts` is where that answer lives.
 *
 * Nothing here refuses on those grounds. A layout for another game is still a
 * layout somebody can want, so the warning is loud and the map still takes the
 * click. The one thing that is refused is a layout with no buildings in it, and
 * `./layoutPlacing.ts` says why.
 */

import { Blocks } from "lucide-react";
import { useMemo } from "react";
import { blueprintArrival } from "@/blueprint/arrival";
import type { Footprint } from "@/blueprint/footprint";
import { footprintsFromUnits, type StoredBlueprint } from "@/blueprint/library";
import { LayoutThumb } from "@/blueprint/pages/components/LayoutThumb";
import { blueprintPayload } from "@/blueprint/transfer";
import type { KnownUnits } from "@/blueprint/units";
import { unknownBuildings, unknownUnitsWarning } from "@/blueprint/units";
import { OptionSelect } from "@/components/OptionSelect";
import type { InstalledGameInfo } from "@/container/gameIdentity";
import type { UnitDatasetEntry } from "@/content/bindings";
import {
  type LayoutChoice,
  layoutChoiceKey,
  layoutOptions,
  parseLayoutChoice,
} from "@/lib/scenarioEditing/layoutPlacing";
import type { Scenario } from "../../model";
import { TeamSelect } from "./TeamSelect";

/** What one arriving layout is worth saying about, worst first, and what it
 *  will be called once it is in the document. */
export interface LayoutPlacement {
  /** The name the layout takes in this scenario, which is its own unless
   *  something here already answers to that. */
  name: string;
  notes: { tone: "note" | "warn"; text: string }[];
}

/**
 * What placing the chosen layout would mean, or null when nothing is chosen.
 *
 * A library layout goes through the full arrival check, against the mission's
 * game rather than against every game on the machine. A layout the scenario
 * already holds only needs the unit half: it is already in this document, so
 * there is no other game to name, but a scenario whose game was changed under
 * it can be holding a layout none of whose units survive.
 */
export function layoutPlacement(
  scenario: Scenario,
  choice: LayoutChoice | null,
  records: readonly StoredBlueprint[],
  installed: readonly InstalledGameInfo[] | null,
  known: KnownUnits | undefined,
): LayoutPlacement | null {
  if (!choice) return null;
  if (choice.from === "scenario") {
    const layout = scenario.blueprints.find((b) => b.id === choice.id);
    if (!layout) return null;
    const missing = unknownUnitsWarning(
      unknownBuildings(layout.buildings, known),
      layout.buildings.length,
    );
    return {
      name: layout.name,
      notes: missing ? [{ tone: "warn", text: missing }] : [],
    };
  }
  const record = records.find((one) => one.id === choice.id);
  if (!record) return null;
  const arrival = blueprintArrival({
    payload: record.layout,
    taken: scenario.blueprints.map((b) => b.name),
    installed,
    known,
    into: scenario.setup.gameName,
  });
  return { name: arrival.name, notes: arrival.notes };
}

/**
 * A plan of what one option would place, for the picker to list it by.
 *
 * A name and a building count say how big a base is and nothing about its
 * shape, so choosing between four saved bases meant placing each one to find
 * out which was which. This is the drawing the library's own cards use, at the
 * size a dropdown row has room for.
 *
 * A library layout carries its own footprints, so it draws at the right size
 * wherever it came from. A scenario's own has none stored: they are worked out
 * from the game's units here, the same way saving one to the library works them
 * out. With the units unread every building falls back to one build square,
 * which is a rough plan rather than no plan.
 */
function optionPreview(
  scenario: Scenario,
  records: readonly StoredBlueprint[],
  value: string,
  footprintOf: ((def: string) => Footprint | undefined) | undefined,
) {
  const choice = parseLayoutChoice(value);
  if (!choice) return null;
  const payload =
    choice.from === "library"
      ? (records.find((one) => one.id === choice.id)?.layout ?? null)
      : (() => {
          const layout = scenario.blueprints.find((b) => b.id === choice.id);
          return layout ? blueprintPayload(layout, { footprintOf }) : null;
        })();
  if (!payload || payload.buildings.length === 0) return null;
  return (
    <span className="flex size-10 shrink-0 items-center justify-center">
      <LayoutThumb layout={payload} />
    </span>
  );
}

export function LayoutPlacer({
  scenario,
  records,
  choice,
  onChoice,
  placement,
  team,
  onTeam,
  units,
}: {
  scenario: Scenario;
  records: readonly StoredBlueprint[];
  choice: LayoutChoice | null;
  onChoice: (choice: LayoutChoice | null) => void;
  placement: LayoutPlacement | null;
  /** The participant the base will belong to, already fallen back to the first
   *  one, so this is empty only when the scenario has no participants. */
  team: string;
  onTeam: (team: string) => void;
  /** The game's units, for the footprints a scenario's own layout is drawn at.
   *  Empty until the dataset has been read, and then each building is drawn as
   *  one build square. */
  units: readonly UnitDatasetEntry[];
}) {
  const footprintOf = useMemo(() => footprintsFromUnits([...units]), [units]);
  const options = useMemo(
    () =>
      layoutOptions(scenario, records, scenario.setup.gameName).map(
        (option) => ({
          ...option,
          preview: optionPreview(scenario, records, option.value, footprintOf),
        }),
      ),
    [scenario, records, footprintOf],
  );
  const participants = scenario.setup.participants;

  return (
    <>
      <OptionSelect
        size="sm"
        className="w-56"
        value={choice ? layoutChoiceKey(choice) : ""}
        onValueChange={(next) => onChoice(parseLayoutChoice(next))}
        options={options}
        placeholder={
          options.length === 0 ? "No blueprints yet" : "Pick a blueprint…"
        }
        disabled={options.length === 0}
      />
      <TeamSelect
        participants={participants}
        value={team}
        onValueChange={onTeam}
      />

      {options.length === 0 && (
        <p className="w-full text-[11px] text-muted-foreground">
          There is nothing to place. Draw a base with Bases, or keep one in your
          library under Content, Base blueprints.
        </p>
      )}

      {participants.length === 0 && (
        <p className="w-full rounded bg-amber-950/60 px-2 py-1 text-[11px] text-amber-200">
          This scenario has no participants yet, and a base on the map belongs
          to one. Add a participant in the setup below the map first.
        </p>
      )}

      {placement?.notes.map((note) => (
        <p
          key={note.text}
          className={
            note.tone === "warn"
              ? "w-full rounded bg-amber-950/60 px-2 py-1 text-[11px] text-amber-200"
              : "w-full text-[11px] text-muted-foreground"
          }
        >
          {note.text}
        </p>
      ))}

      {placement && choice?.from === "library" && (
        <p className="w-full text-[11px] text-muted-foreground">
          <Blocks className="mr-1 inline size-3" aria-hidden />
          Placing this copies it into the scenario, so what you share carries
          the layout rather than pointing at your library. It arrives with
          nothing a trigger can address and nothing queued.
        </p>
      )}
    </>
  );
}
