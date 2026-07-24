import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * Typed bindings to the challenge file-export commands on the `coilbox-content`
 * plugin (issue #476). Both are opaque write paths (mirroring `campaign_export`),
 * the frontend builds the container text via `code.ts` and picks the destination
 * via the save/open dialog, Rust only reads/writes bytes.
 */

/** Write a challenge container's text to `dest`. */
export const challengeExport = defineCommand<
  { dest: string; text: string },
  Record<string, never>
>("coilbox-content", "content_export_challenge");

/** Read a challenge file the user picked, the caller decodes/validates it
 * through the same `decodeChallenge` as a pasted code. */
export const challengeImport = defineCommand<{ src: string }, { text: string }>(
  "coilbox-content",
  "content_import_challenge",
);
