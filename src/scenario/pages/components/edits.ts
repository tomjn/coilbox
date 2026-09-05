/**
 * What an edit to a scenario is, and how one is applied.
 *
 * An edit used to be a finished document: the map or a panel took the document
 * it had last been rendered with, made a new one out of it, and handed that
 * back. Two edits asked for before React rendered again were therefore both
 * built on the document as it stood before either of them, so the second one
 * landed on top of the first and the first was gone. Four clicks on the map in
 * one tick put down one actor, and two clicks meant to put two buildings in a
 * base put down one (issue #904).
 *
 * So an edit made on the map is a function: what to make of the document as it
 * stands, which after a click is the document that click produced rather than
 * the one the render before it was given. The editor already keeps that
 * document in a ref, because undo has always had to read it at the moment a key
 * is pressed rather than at the last render.
 *
 * A finished document is still an edit, which is what the panels under the map
 * hand back. A form's change and the render that follows it cannot be in the
 * same tick, so there is nothing there for this to fix.
 *
 * The write path had the same shape and is fixed separately: two saves racing
 * each other lost an edit too, which is what `saving.ts` is about.
 */

import {
  type EditHistory,
  type HistoryStep,
  recordEdit,
} from "@/lib/scenarioEditing/history";
import type { Scenario } from "../../model";

/** A document, or how to make one from the document as it stands. */
export type ScenarioEdit = Scenario | ((current: Scenario) => Scenario);

/**
 * The document an edit makes of the one it is applied to.
 *
 * A function edit is called once and straight away, so a caller may take what
 * it needs out of it: placing a building has to know which base the document
 * put it in before it can select it.
 */
export function editedScenario(
  current: Scenario,
  edit: ScenarioEdit,
): Scenario {
  return typeof edit === "function" ? edit(current) : edit;
}

/**
 * An edit applied: the document to show and save, and the history to keep.
 *
 * Each edit is recorded against the document it was applied to, so two
 * placements made in one tick are two steps back rather than one.
 */
export function applyEdit(
  current: Scenario,
  history: EditHistory<Scenario>,
  edit: ScenarioEdit,
): HistoryStep<Scenario> {
  const document = editedScenario(current, edit);
  return { document, history: recordEdit(history, current, document) };
}
