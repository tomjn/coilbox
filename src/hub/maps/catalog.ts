import { defineCommand } from "@picoframe/plugin-sdk";
import type { MapCatalogEntry } from "../../content/bindings";

/**
 * The two hub calls a map catalog sweep makes (issue #1736), as the webview sees
 * them.
 *
 * Thin on purpose. Everything that decides anything is in Rust: the token, the
 * consent check, the batching to the hub's own caps, and the check that answers
 * come back in the order they were asked. What is here is the shape of the
 * question and the shape of the answer.
 */

/** One key: which map, which archive it came from, and which extraction read it. */
export interface MapHaveKey {
  map_name: string;
  source_hash: string;
  catalog_version: number;
}

export type MapHaveStatus = "have" | "changed" | "missing";

export interface MapHaveResult {
  map_name: string;
  status: MapHaveStatus;
}

/**
 * Whether this map is worth sending.
 *
 * `changed` and `missing` both mean send it, and they stay apart because a sweep
 * reporting which it was is worth reading: a run full of `changed` after an
 * update is a catalog upgrade landing, and one full of `missing` is a corpus
 * nobody has submitted yet.
 */
export function wantsSubmission(status: MapHaveStatus): boolean {
  return status !== "have";
}

export type MapSubmitOutcome =
  | "stored"
  | "replaced"
  | "unchanged"
  | "conflict"
  | "refused";

export interface MapSubmitResult {
  map_name: string;
  outcome: MapSubmitOutcome;
  /** Why, on a refusal. */
  said?: string;
}

const hubMapsHave = defineCommand<
  { hubUrl: string; keys: MapHaveKey[] },
  { results: MapHaveResult[] }
>("coilbox-hub", "hub_maps_have");

const hubPublishMaps = defineCommand<
  { hubUrl: string; entries: MapCatalogEntry[] },
  { results: MapSubmitResult[] }
>("coilbox-hub", "hub_publish_maps");

/**
 * Ask the hub which of these maps it still wants, answered in the order they
 * were given.
 *
 * An empty set asks nobody, because the hub refuses an empty batch and the
 * caller of this is a loop.
 */
export async function mapsTheHubWants(
  hubUrl: string,
  keys: MapHaveKey[],
): Promise<MapHaveResult[]> {
  if (keys.length === 0) return [];
  const { results } = await hubMapsHave({ hubUrl, keys });
  return results;
}

/**
 * Send these maps' facts, and say what the hub did with each.
 *
 * One outcome per entry in the order they were given. A batch is split to the
 * hub's caps on the Rust side, so this takes as many entries as the caller has.
 */
export async function publishMapFacts(
  hubUrl: string,
  entries: MapCatalogEntry[],
): Promise<MapSubmitResult[]> {
  if (entries.length === 0) return [];
  const { results } = await hubPublishMaps({ hubUrl, entries });
  return results;
}
