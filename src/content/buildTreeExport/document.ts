/**
 * Pure HTML document assembler for the build-tree export. Wraps the per-faction
 * canvases (`scene.ts`) in the branded-or-neutral frame: header, faction tabs,
 * legend (mirroring `BuildTreeLegend`), and the attribution footer. Assets (css/
 * js) are inlined for the single-file html or linked for the zip.
 */

import { TREE_JS } from "./runtime";
import { esc, renderFactionCanvas } from "./scene";
import { TREE_CSS } from "./styles";
import type { ExportInput, ExportOptions } from "./types";

/** How the css/js are referenced. Inline → single-file html; linked → zip. */
export interface AssetMode {
  inline: boolean;
}

/** The header: branded (banner/logo/title/links from catalog) or neutral text.
 * Branded falls back to the game name when a field is missing, so a partial or
 * absent catalog entry still renders cleanly. */
function renderHeader(input: ExportInput, opts: ExportOptions): string {
  const b = opts.wrapper === "branded" ? input.branding : undefined;
  const title = esc(b?.title || input.gameName);
  const banner = b?.bannerDataUrl
    ? `<img class="banner" src="${esc(b.bannerDataUrl)}" alt="" />`
    : "";
  const logo = b?.logoDataUrl
    ? `<img class="logo" src="${esc(b.logoDataUrl)}" alt="" />`
    : "";
  const links = b?.links?.length
    ? `<nav class="links">${b.links
        .map(
          (l) =>
            `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`,
        )
        .join("")}</nav>`
    : "";
  return `<header class="brand">${banner}${logo}<h1>${title}</h1>${links}</header>`;
}

/** The faction tab strip (only when more than one faction is exported). */
function renderTabs(input: ExportInput): string {
  if (input.factions.length <= 1) return "";
  const tabs = input.factions
    .map(
      (f, i) =>
        `<button type="button" class="tab" role="tab" data-tab="${esc(f.side)}" aria-selected="${i === 0}">${esc(f.side)}</button>`,
    )
    .join("");
  return `<div class="tabs" role="tablist">${tabs}</div>`;
}

/** Colour/line key above the canvas, mirroring the app's `BuildTreeLegend`. */
function renderLegend(): string {
  return `<div class="legend">
<span><span class="swatch" style="border-color:#60a5fa"></span>Commander</span>
<span><span class="swatch" style="border-color:#facc15"></span>Builder</span>
<span><span class="swatch" style="border-color:#fb7185"></span>Unit</span>
<span><span class="swatch" style="border-color:#94a3b8"></span>Building</span>
<span><span class="line" style="background:#4ade80"></span>Builds (hover)</span>
<span><span class="line" style="background:#facc15"></span>Built by (hover)</span>
<span><span class="dash"></span>Also buildable by</span>
</div>`;
}

/** The attribution footer. The date is the single isolated non-deterministic
 * line, so re-exports of the same game diff to at most this element. */
function renderFooter(input: ExportInput): string {
  return `<footer class="attn">${esc(input.gameName)} · exported from coilbox · <span class="export-date">${esc(input.date)}</span></footer>`;
}

/**
 * Assemble the full standalone HTML. `href` resolves a node id to its pic
 * reference (inline data URL or relative `images/` path); `assets.inline` picks
 * inline `<style>`/`<script>` vs linked `assets/tree.{css,js}`.
 */
export function renderDocument(
  input: ExportInput,
  opts: ExportOptions,
  href: (id: string) => string | undefined,
  assets: AssetMode,
): string {
  const head = assets.inline
    ? `<style>${TREE_CSS}</style>`
    : `<link rel="stylesheet" href="assets/tree.css" />`;
  const script = assets.inline
    ? `<script>${TREE_JS}</script>`
    : `<script src="assets/tree.js"></script>`;
  const canvases = input.factions
    .map(
      (f, i) =>
        `<section class="faction${i === 0 ? " active" : ""}" data-side="${esc(f.side)}" role="tabpanel">${renderFactionCanvas(f, href)}</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(input.gameName)} — Build tree</title>
${head}
</head>
<body>
<div class="wrap">
${renderHeader(input, opts)}
${renderTabs(input)}
${renderLegend()}
${canvases}
${renderFooter(input)}
</div>
${script}
</body>
</html>
`;
}
