/**
 * The exported page's stylesheet, as a constant string. Inlined into a `<style>`
 * for the single-file html, or written as `assets/tree.css` for the zip. Dark,
 * coilbox-adjacent theme; hover transitions are wrapped in
 * `prefers-reduced-motion: reduce` so motion-sensitive users get instant states.
 */
export const TREE_CSS = `:root {
  --bg: #0a0a0a;
  --panel: #18181b;
  --border: #3f3f46;
  --text: #e4e4e7;
  --muted: #a1a1aa;
  --edge: #71717a;
  --builds: #4ade80;
  --builtby: #facc15;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
.wrap { display: flex; flex-direction: column; min-height: 100vh; }
header.brand {
  display: flex; align-items: center; gap: 16px;
  padding: 16px 24px; border-bottom: 1px solid var(--border);
  background: var(--panel);
}
header.brand .banner {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; opacity: 0.25; z-index: 0;
}
header.brand { position: relative; overflow: hidden; }
header.brand .logo { height: 40px; width: auto; z-index: 1; }
header.brand h1 { font-size: 20px; margin: 0; z-index: 1; }
header.brand .links { margin-left: auto; display: flex; gap: 12px; z-index: 1; }
header.brand .links a { color: var(--text); text-decoration: none; opacity: 0.85; }
header.brand .links a:hover { text-decoration: underline; opacity: 1; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 24px 0; }
.tab {
  appearance: none; cursor: pointer; font: inherit;
  background: var(--panel); color: var(--muted);
  border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px;
}
.tab[aria-selected="true"] { color: var(--text); background: #27272a; }
.tab:focus-visible { outline: 2px solid var(--builds); outline-offset: 2px; }
.legend {
  display: flex; flex-wrap: wrap; gap: 6px 16px;
  padding: 12px 24px; color: var(--muted); font-size: 12px;
}
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.legend .swatch { width: 12px; height: 12px; border-radius: 3px; border: 2px solid; }
.legend .line { width: 16px; height: 2px; border-radius: 2px; }
.legend .dash { width: 16px; border-top: 2px dashed var(--muted); }
.toolbar {
  display: flex; flex-wrap: wrap; align-items: center;
  justify-content: space-between; gap: 8px 16px; padding-right: 24px;
}
.search { position: relative; width: 256px; max-width: 100%; }
.search input {
  width: 100%; font: inherit; color: var(--text);
  background: var(--panel); border: 1px solid var(--border);
  border-radius: 8px; padding: 6px 10px;
}
.search input:focus-visible { outline: 2px solid var(--builds); outline-offset: 2px; }
.search ul {
  position: absolute; left: 0; right: 0; z-index: 5; margin: 4px 0 0; padding: 4px;
  list-style: none; max-height: 288px; overflow-y: auto;
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
}
.search li { display: flex; flex-direction: column; padding: 6px 8px; border-radius: 4px; cursor: pointer; }
.search li[aria-selected="true"], .search li:hover { background: #27272a; }
.search li.none { color: var(--muted); cursor: default; }
.search .name, .search .key { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.search .key { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); }
[hidden] { display: none !important; }
.faction { flex: 1; padding: 0 24px 24px; display: none; min-height: 0; }
.faction.active { display: flex; flex-direction: column; }
.stage { flex: 1; display: flex; gap: 12px; min-height: 0; }
.detail {
  position: relative; width: 288px; flex-shrink: 0; overflow-y: auto;
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
  padding: 12px;
}
.detail-close {
  position: absolute; top: 6px; right: 6px; appearance: none; cursor: pointer;
  font: 18px/1 inherit; color: var(--muted); background: none; border: 0;
  border-radius: 6px; min-width: 28px; min-height: 28px;
}
.detail-close:hover { color: var(--text); background: #27272a; }
.detail-close:focus-visible { outline: 2px solid var(--builds); outline-offset: 2px; }
.detail-title { margin: 0 32px 0 0; font-size: 15px; line-height: 1.3; }
.detail-id { margin: 2px 0 12px; color: var(--muted); font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.detail-none { color: var(--muted); font-size: 13px; }
.detail-stats { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; margin: 0 0 12px; font-size: 13px; }
.detail-stats div { display: contents; }
.detail-stats dt { color: var(--muted); }
.detail-stats dd { margin: 0; }
.detail-weapons { width: 100%; border-collapse: collapse; font-size: 12px; }
.detail-weapons th { text-align: left; color: var(--muted); font-weight: 500; padding: 4px 6px 4px 0; border-bottom: 1px solid var(--border); }
.detail-weapons td { padding: 4px 6px 4px 0; border-bottom: 1px solid #27272a; overflow-wrap: anywhere; }
@media (max-width: 720px) {
  .stage { flex-direction: column; }
  .detail { width: auto; }
}
.scene-wrap {
  position: relative; flex: 1; min-width: 0; min-height: 60vh;
  border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
  background: var(--bg); touch-action: none;
}
svg.scene { width: 100%; height: 100%; cursor: grab; display: block; }
svg.scene.grabbing { cursor: grabbing; }
.minimap {
  position: absolute; right: 10px; bottom: 10px;
  border: 1px solid var(--border); border-radius: 4px; background: var(--bg);
}
.scene-wrap.focus .minimap { display: none; }
.minimap-bg { fill: #050505; }
.minimap-view { fill: rgba(147,197,253,0.15); stroke: #93c5fd; stroke-width: 3; }
/* Nodes */
.node .ring { fill: #18181b; stroke-width: 2; }
.node .pic { border-radius: 4px; }
.node .nopic { fill: #27272a; }
.node .nopic-label { fill: var(--muted); font-size: 11px; text-anchor: middle; dominant-baseline: middle; }
.node .label { fill: var(--text); font-size: 11px; text-anchor: middle; }
.node { cursor: pointer; }
.node:focus-visible { outline: none; }
.node:focus-visible .ring { stroke: var(--builds) !important; stroke-width: 3; }
/* Edges */
.edge { fill: none; stroke: var(--edge); stroke-width: 1.5; opacity: 0.4; }
.edge-extra { stroke-width: 1; opacity: 0.12; stroke-dasharray: 4 4; }
/* Hover / focus highlight: dim everything, then light incident edges + neighbours */
.scene.hi .node { opacity: 0.18; }
.scene.hi .edge { opacity: 0.05; }
.scene.hi .node.on { opacity: 1; }
/* Units outside the focus are faded out and out of reach. These selectors outrank the highlight rules, so a hover cannot bring one back. */
.scene .node.off, .scene.hi .node.off { opacity: 0; pointer-events: none; }
.scene .edge.off { opacity: 0; }
.edge.builds { stroke: var(--builds); stroke-width: 2.5; opacity: 1; }
.edge.builtby { stroke: var(--builtby); stroke-width: 2.5; opacity: 1; }
.edge.builds.edge-extra, .edge.builtby.edge-extra { stroke-dasharray: 6 4; }
footer.attn {
  padding: 12px 24px; border-top: 1px solid var(--border);
  color: var(--muted); font-size: 12px;
}
@media (prefers-reduced-motion: no-preference) {
  .node, .edge { transition: opacity 300ms ease, stroke 300ms ease, stroke-width 300ms ease; }
}
`;
