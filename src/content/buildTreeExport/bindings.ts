import { defineCommand } from "@picoframe/plugin-sdk";
import type { ExportFile } from "./types";

/**
 * Typed bindings to the build-tree export commands on the `coilbox-content`
 * plugin. Both are opaque write paths (mirroring `campaign_export`): the frontend
 * builds the whole artifact and picks the destination via the save dialog; Rust
 * only writes bytes / assembles the zip.
 */

/** Write a single self-contained export HTML file to `dest`. */
export const contentExportBuildTreeHtml = defineCommand<
  { dest: string; html: string },
  Record<string, never>
>("coilbox-content", "content_export_build_tree_html");

/** Assemble the export zip (index.html + images/ + assets/) at `dest`. */
export const contentExportBuildTreeZip = defineCommand<
  { dest: string; files: ExportFile[] },
  Record<string, never>
>("coilbox-content", "content_export_build_tree_zip");
