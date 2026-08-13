/**
 * Blueprint export and import (issue #1417). A shared layout is a canonical
 * coilbox container (`../container/container.ts`) with `kind: "blueprint"`, so
 * it goes to other people the way every other shareable thing in coilbox does:
 * through the Coilbox hub, or as a `.json` file, or as a pasted code.
 *
 * The wire shape and its reader are in `./payload.ts`, which the hub vendors.
 * This file is the half that only makes sense here: turning the app's own
 * `BaseBlueprint` into that shape and back, and the footprints, which come from
 * unitsync and so can only be gathered on a machine with the game installed.
 *
 * There is no legacy reader. A standalone blueprint has never had another
 * format. A layout in Beyond All Reason's own `blueprints.json` is a different
 * thing, read and written by `./bar.ts`, and it is a game's file rather than
 * something coilbox shares.
 */

import {
  decodeContainerText,
  encodeContainerJson,
  type OpenError,
  type OpenResult,
  readContainer,
  tryEncodeContainerCode,
} from "../container/container";
import {
  gameIdentityForName,
  type InstalledGameInfo,
} from "../container/gameIdentity";
import { formatBytes } from "../content/rapidPool";
import type { Footprint } from "./footprint";
import type { BaseBlueprint } from "./model";
import {
  type BlueprintPayload,
  type PayloadFootprint,
  parseBlueprintPayload,
} from "./payload";

/**
 * Payload schema version for `kind: "blueprint"`. One, and it stays one until
 * the shape changes in a way a reader has to be told about: a field added
 * beside the existing ones is additive, and an older build ignoring it reads
 * the layout exactly as it always did (the reasoning `../campaign/transfer.ts`
 * sets out at length).
 */
export const BLUEPRINT_KIND_VERSION = 1;

/** What an export needs that a layout does not carry. */
export interface BlueprintExportOptions {
  /**
   * How much ground each def stands on, which is `buildingFootprints(units)`
   * from `./footprint.ts` for the game's units. Passed in rather than looked up
   * here because it comes from a unitsync scan, and this file is arithmetic.
   */
  footprintOf: (def: string) => Footprint;
  /** The archive name of the game these def names belong to. Absent on a layout
   *  whose game is not known, which costs the reader the ability to say what it
   *  is for. */
  gameName?: string;
  /** This machine's installed games, read only for the modinfo shortname. */
  installed?: readonly InstalledGameInfo[];
}

/** What each def in the layout stands on, stated once per def. */
function footprintsFor(
  layout: BaseBlueprint,
  footprintOf: (def: string) => Footprint,
): Record<string, PayloadFootprint> {
  const footprints: Record<string, PayloadFootprint> = {};
  for (const building of layout.buildings) {
    const key = building.def.toLowerCase();
    if (key in footprints) continue;
    const { x, z } = footprintOf(building.def);
    footprints[key] = { x, z };
  }
  return footprints;
}

/** The layout as it will travel. One builder for the file and the code, so the
 *  two can never disagree about what a layout says. */
export function blueprintPayload(
  layout: BaseBlueprint,
  options: BlueprintExportOptions,
): BlueprintPayload {
  const game = options.gameName
    ? gameIdentityForName(options.gameName, options.installed ?? [])
    : null;
  return {
    ...(game ? { game } : {}),
    name: layout.name,
    ...(layout.designedFor ? { designedFor: layout.designedFor } : {}),
    ...(layout.ordered ? { ordered: true } : {}),
    buildings: layout.buildings.map((building) => ({
      def: building.def,
      offset: { x: building.offset.x, z: building.offset.z },
      facing: building.facing,
      ...(building.originalName
        ? { originalName: building.originalName }
        : {}),
    })),
    footprints: footprintsFor(layout, options.footprintOf),
  };
}

/**
 * Wrap a payload as an export file's text.
 *
 * The library stores the wire shape (`./library.ts`), so sharing a kept layout
 * is this rather than {@link encodeBlueprintJson}: rebuilding the payload would
 * need the footprints again, and those come from a unitsync read the sharer may
 * not be able to do right now for a layout whose game they have since removed.
 */
export function encodePayloadJson(payload: BlueprintPayload): string {
  return encodeContainerJson("blueprint", BLUEPRINT_KIND_VERSION, payload);
}

/** Serialize a layout as an export file's text. */
export function encodeBlueprintJson(
  layout: BaseBlueprint,
  options: BlueprintExportOptions,
): string {
  return encodePayloadJson(blueprintPayload(layout, options));
}

/** A pasteable blueprint code, or why this layout cannot have one. */
export type BlueprintCode =
  | { ok: true; code: string }
  | { ok: false; message: string };

/**
 * Encode a layout as a pasteable code, or refuse when the result would be past
 * what the far end will inflate.
 *
 * Nothing bounds how many buildings a layout has, so the refusal is real rather
 * than theoretical, and it belongs here rather than on import: a code that has
 * already been pasted into Discord is past the point where anyone can fix it. A
 * layout has to be improbably large to reach the ceiling, though. Four hundred
 * buildings is a code of a few thousand characters, because the buildings are
 * repetitive text that compresses hard and the footprints are one entry per def
 * rather than one per building.
 */
export function encodePayloadCode(payload: BlueprintPayload): BlueprintCode {
  const result = tryEncodeContainerCode(
    "blueprint",
    BLUEPRINT_KIND_VERSION,
    payload,
  );
  if (result.ok) return result;
  return {
    ok: false,
    message: `This layout is ${formatBytes(result.bytes)}, past the ${formatBytes(result.limit)} a share code can carry. Export it as a file and send that instead.`,
  };
}

export function encodeBlueprintCode(
  layout: BaseBlueprint,
  options: BlueprintExportOptions,
): BlueprintCode {
  return encodePayloadCode(blueprintPayload(layout, options));
}

/**
 * Read an exported blueprint file, or a pasted code, which the container
 * decodes for free. Returns the typed failure rather than a bare null, so an
 * import can tell "this is a scenario, not a blueprint" from "this file is
 * damaged". Never throws.
 */
export function readBlueprintContainer(
  text: string,
): OpenResult<BlueprintPayload> {
  return readContainer(
    decodeContainerText(text),
    "blueprint",
    parseBlueprintPayload,
  );
}

/**
 * The layout inside a payload, with no id on it. Whoever puts it in a library
 * or a document mints the id, so reading the same file twice does not produce
 * two layouts claiming to be the same one. Same rule as an import from a game's
 * own file in `./format.ts`.
 */
export function blueprintFromPayload(
  payload: BlueprintPayload,
): Omit<BaseBlueprint, "id"> {
  return {
    name: payload.name,
    ...(payload.designedFor ? { designedFor: payload.designedFor } : {}),
    ...(payload.ordered ? { ordered: true } : {}),
    buildings: payload.buildings.map((building) => ({
      def: building.def,
      offset: { x: building.offset.x, z: building.offset.z },
      facing: building.facing,
      ...(building.originalName
        ? { originalName: building.originalName }
        : {}),
    })),
  };
}

/** What an import failure says, for an inline error banner. */
export function blueprintImportErrorMessage(error: OpenError): string {
  switch (error) {
    case "unknown-format":
      return "That file isn't a coilbox blueprint.";
    case "unsupported-version":
      return "That blueprint was made by a newer version of coilbox. Update coilbox to open it.";
    case "wrong-kind":
      return "That's a coilbox file, but not a blueprint.";
    default:
      return "That blueprint file is damaged or incomplete.";
  }
}
