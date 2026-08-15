/**
 * Asking the hub what it already has, from the webview (issue #1636).
 *
 * `hub_assets_have` in the `coilbox-hub` plugin, which is the same check the
 * upload makes for itself. The upload asking is not enough on its own: a render
 * is drawn here, in the webview, and by the time an upload could ask about one
 * the drawing has already happened. That is the cost the whole design exists to
 * avoid, so this is the door that lets the question come first.
 *
 * What makes it possible is that a render's identity is over the model rather
 * than over the pixels, so `unitsync_unit_render_keys` can name one without
 * drawing it (issue #1672). Read the keys, ask here, draw only what comes back
 * wanted.
 *
 * Every key handed over is one the caller already had a reason to ask about. The
 * answers spend an allowance the whole community shares, so this is never how a
 * roster gets walked.
 */

import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * Which of the hub's two key shapes addresses a picture. They are different
 * shapes on purpose and do not unify: a caller says which one it means rather
 * than filling in whichever fields it happens to have.
 *
 * Snake case because these cross into Rust as struct fields, which serde reads
 * by their declared names. Tauri only camelCases the command's own arguments.
 */
export type AssetIdentity =
  | {
      keyed_on: "unit";
      /** The game's modinfo shortname, never a version and never an archive
       *  name: the key exists to survive a version bump. */
      game: string;
      unit_name: string;
      variant: string;
    }
  | {
      keyed_on: "map";
      /** The full name unitsync reports, version string and all, never split. */
      map_name: string;
      variant: string;
    };

/** One key to ask about: which picture, and the `source_hash` the caller holds
 *  for it. Over the source rather than the encoded bytes, which is what lets it
 *  be known before the picture is made.
 *
 *  Flat rather than nested, because the identity is flattened into the row on
 *  the Rust side and the hub reads it that way. */
export type AssetKey = AssetIdentity & { source_hash: string };

/**
 * What the hub wants done with one key. `have` means render nothing, encode
 * nothing and upload nothing. The other two are both worth making the picture
 * for: `changed` is a source that has moved since, `missing` is an identity the
 * hub has no row for.
 */
export type HaveStatus = "have" | "changed" | "missing";

/** One answer, carrying the key it is about in the shape it was sent. */
export type HaveResult = AssetIdentity & { status: HaveStatus };

/** Whether this key is worth spending a render and an encode on. The point of
 *  asking first is that most of a real batch answers false here. */
export function wantsUpload(status: HaveStatus): boolean {
  return status !== "have";
}

const hubAssetsHave = defineCommand<
  { hubUrl: string; keys: AssetKey[] },
  { results: HaveResult[] }
>("coilbox-hub", "hub_assets_have");

/**
 * Ask the hub which of these it still wants, answered in the order they were
 * given so a caller can zip the two by index.
 *
 * An empty set asks nobody, which matters because the callers of this are loops
 * and the hub refuses an empty batch. A set larger than the hub's own maximum is
 * split into requests on the Rust side rather than refused.
 */
export async function assetsTheHubWants(
  hubUrl: string,
  keys: AssetKey[],
): Promise<HaveResult[]> {
  if (keys.length === 0) return [];
  const { results } = await hubAssetsHave({ hubUrl, keys });
  return results;
}
