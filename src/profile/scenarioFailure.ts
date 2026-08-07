/**
 * What to say about a bundled scenario coilbox would not load (issue #962).
 *
 * `listScenarios` skips a document it cannot read with a console warning, so a
 * package whose scenario file is wrong ships a scenario that is simply not
 * there. The distribution health panel is where whoever built the package finds
 * out, and this is the sentence it shows them.
 *
 * Its own module rather than a private in `useHealthChecks`, because that module
 * reaches the whole plugin graph and this is the part worth testing on its own.
 */

import {
  readScenarioExport,
  scenarioImportErrorMessage,
} from "../scenario/transfer";
import { describeJsonError } from "./jsonError";

/** One rejected scenario, in the words the panel lists it by. */
export interface ScenarioFailureText {
  /** The document's own `name`, or a placeholder when nothing readable says. */
  name: string;
  /** Why it was rejected. */
  error: string;
}

/**
 * The scenario's own `name`. A bundled scenario is the export file the builder
 * wrote, so its name sits a layer down inside the container's payload, while a
 * local one is the bare document.
 */
function scenarioName(json: string): string {
  try {
    const o = JSON.parse(json) as {
      name?: unknown;
      payload?: { scenario?: { name?: unknown } };
    };
    const name =
      typeof o?.name === "string" ? o.name : o?.payload?.scenario?.name;
    if (typeof name === "string" && name.trim()) return name;
  } catch {
    // Unparseable, so the syntax error is the useful part, not the name.
  }
  return "(unnamed)";
}

/**
 * Why a scenario was rejected. A container that identifies itself is described
 * in the words import already uses, so "made by a newer coilbox" reads as
 * itself rather than as generic damage. Anything else is a JSON syntax error,
 * located, or a document that is simply not a scenario.
 */
function scenarioError(json: string): string {
  try {
    JSON.parse(json);
  } catch (e) {
    return describeJsonError(json, e).message;
  }
  const read = readScenarioExport(json);
  if (!read.ok && read.error !== "unknown-format") {
    return scenarioImportErrorMessage(read.error);
  }
  return "valid JSON but does not match the scenario schema";
}

/** One rejected scenario document, named and explained. */
export function describeScenarioFailure(json: string): ScenarioFailureText {
  return { name: scenarioName(json), error: scenarioError(json) };
}
