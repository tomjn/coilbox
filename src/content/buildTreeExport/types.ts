/**
 * Types for the standalone build-tree HTML export (issue #363).
 *
 * The export turns a game's per-faction build graph into a self-contained
 * interactive page that opens in any plain browser — no coilbox, unitsync or
 * React Flow at runtime. Everything here is a plain data shape so the generators
 * (`scene.ts`, `document.ts`, `index.ts`) stay pure and unit-testable without a
 * browser or the app.
 */

/** Node visual box (px). Kept smaller than the layout cell (104×124) so nodes
 * never overlap once positioned. The build-pic is a square filling the width. */
export const NODE_W = 92;
export const NODE_H = 112;

/** Ring/dot colour class for a unit, mirroring `BuildTreeDrawer`'s semantics:
 * commander (blue) > builder (yellow) > mobile (rose) > building (slate). */
export type UnitKind = "commander" | "builder" | "mobile" | "building";

/** One positioned unit in the exported scene. `x`/`y` are the box top-left,
 * straight from `layoutBuildTree`. `icon` is a base64 `data:` URL when a pic
 * resolved (absent → the node renders a "no pic" placeholder, never a broken
 * image). `iconExt` is the pic's file extension for the zip's `images/` files. */
export interface ExportNode {
  id: string;
  x: number;
  y: number;
  label: string;
  kind: UnitKind;
  icon?: string;
  iconExt?: string;
}

/** One builder→unit edge. `extra` marks the faint dashed "also buildable by"
 * edges the spanning tree omits (same split as `buildBuildGraph`). */
export interface ExportEdge {
  source: string;
  target: string;
  extra: boolean;
}

/** One faction's laid-out graph plus its scene bounds (for the SVG `viewBox`). */
export interface ExportFaction {
  /** Display name, also the tab label and the `<section data-side>` key. */
  side: string;
  nodes: ExportNode[];
  edges: ExportEdge[];
  width: number;
  height: number;
}

/** Branded-wrapper assets pulled from the game's catalog entry. All optional so
 * a game with no catalog entry falls back to the neutral text header cleanly. */
export interface ExportBranding {
  title?: string;
  bannerDataUrl?: string;
  logoDataUrl?: string;
  links?: { label: string; url: string }[];
}

/** The full serialized artifact input. `date` is passed in from the frontend —
 * the only non-deterministic value — so re-exports diff to one line. */
export interface ExportInput {
  gameName: string;
  factions: ExportFaction[];
  branding?: ExportBranding;
  date: string;
}

/** The three export-time option axes from the popover. */
export interface ExportOptions {
  /** Reflected in `factions.length`; kept for the footer/notes. */
  scope: "all" | "current";
  wrapper: "branded" | "neutral";
  format: "html" | "zip";
}

/** A file to write for the zip format. Exactly one of `text`/`base64` is set. */
export interface ExportFile {
  path: string;
  text?: string;
  base64?: string;
}

/** The generator output: a single HTML string, or the zip file set. */
export type ExportArtifact =
  | { format: "html"; html: string }
  | { format: "zip"; files: ExportFile[] };
