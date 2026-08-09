import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * Reading a file the user picked in the import box (issue #1333).
 *
 * The box takes a `.json` before it knows what kind it holds, so it cannot use
 * any one kind's import command (`content_import_challenge`, `scenario_import`,
 * `campaign_import`). Rust hands back the raw text and `readImport` works out
 * the rest.
 */
export const importContainerFile = defineCommand<
  { src: string },
  { text: string }
>("coilbox-content", "content_import_container");
