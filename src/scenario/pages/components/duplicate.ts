/**
 * Copying a scenario (issue #2183).
 *
 * Making a variant of a mission is the ordinary authoring loop, and without this
 * the only way through it was to build a second scenario by hand.
 *
 * The copy carries the dialogue clips, which is the whole of the work here. A
 * clip is stored at `media/<scenarioId>/<file>` and the document names it by
 * bare file name, so the id a document is under decides which files its dialogue
 * resolves to: `scenario_write_mission` copies that folder beside the compiled
 * mission at launch, and the editor's own preview reads `scenario/<id>/<file>`.
 * Issue #2183 says a copy can share the clips the way an attached campaign
 * mission does, but a campaign mission shares them by keeping the *source
 * scenario's id*, which a copy cannot do and still be a separate document. So a
 * copy under a new id with the same document is a scenario whose every portrait
 * and voice clip is missing, and the author has no way to see that until the
 * mission plays silent.
 *
 * Copying the bytes is therefore the only version of this that is not a trap.
 * `gatherScenarioExport` and `storeScenario` already do exactly that pair of
 * steps for import, including dropping a reference to a clip that did not make
 * it, so this is the export path with no file in the middle. It also means the
 * two documents own their clips separately: deleting either one takes only its
 * own folder, which is what makes a copy safe to delete.
 *
 * A mission a game ships keeps its clips inside the game archive rather than in
 * that store, and `gatherScenarioExport` reads those too since issue #2235, so
 * a copy of one lands with its portraits and voices in its own folder like any
 * other.
 */

import type { Scenario } from "../../model";
import { gatherScenarioExport } from "../../scenarioMedia";
import { storeScenario } from "../../storage";

/**
 * What to call a copy of `name`, avoiding the names already in use.
 *
 * "Copy of X", then "Copy of X (2)" and on. Duplicating twice used to be the
 * fastest way to two rows reading identically, which is the problem the row
 * itself was rebuilt around (issue #2179).
 */
export function copyName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const first = `Copy of ${name}`;
  if (!used.has(first)) return first;
  for (let n = 2; ; n += 1) {
    const next = `${first} (${n})`;
    if (!used.has(next)) return next;
  }
}

/**
 * Copy a scenario under a new id and a new name, clips and all, and hand back
 * the stored copy.
 *
 * `taken` is the names already in the list, for {@link copyName}. The copy's
 * timestamps are cleared so `saveScenario` stamps it as written now rather than
 * carrying the original's history, which also puts it at the top of the list the
 * author is looking at.
 */
export async function duplicateScenario(
  scenario: Scenario,
  taken: Iterable<string>,
): Promise<Scenario> {
  const { exported } = await gatherScenarioExport(scenario);
  return storeScenario({
    ...exported,
    scenario: {
      ...exported.scenario,
      name: copyName(scenario.name, taken),
      createdAt: "",
      updatedAt: "",
    },
  });
}
