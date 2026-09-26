/**
 * Beyond All Reason's local mod-option route (issue #1278).
 *
 * A skirmish launch writes its own `[modoptions]` block into the start
 * script it runs, so a project aimed at BAR can reach the engine without a
 * generated game and without a rescan: `compiled.barTweakdefs`
 * (`compile.rs`) goes straight into the bare `tweakdefs` mod option, base64
 * encoded the way BAR's own code decodes it. This is a local launch rather
 * than a lobby export, so nothing here packs a project across BAR's numbered
 * slots or minifies anything to fit one: that packing, with its own rules
 * about ordering and the real character cap, is issue #1277's. A project
 * whose `tweakdefs` payload will not fit in a single bare slot is one this
 * route is not offered for, the same as if the game declared no slot at all.
 */
import type { ConfigOption } from "@/content/bindings";
import type { CompiledMod } from "./compile";

/**
 * UTF-8 text to URL-safe base64, padding stripped: the alphabet
 * `workshop_preflight`'s own round trip check already tests against (issue
 * #1276), and the one issue #1277's packer will use. Kept to that alphabet
 * so a project that passes preflight today decodes the same way once this
 * route and that packer both exist.
 */
export function encodeTweakSlot(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Whether the local BAR route is on offer right now: the game has to declare
 * the bare `tweakdefs` slot by that exact key, and the project has to
 * compile to something. Checked against the key directly rather than through
 * `tweakSlotCounts`, which also counts the numbered slots (`tweakdefs1`..29):
 * this route only ever writes the bare one, see this module's own doc
 * comment, so a game declaring only numbered slots does not make it
 * available even though `deliveryRoutes` counts that game as supporting the
 * tweak slot route in general.
 */
export function barRouteAvailable(
  options: ConfigOption[],
  compiled: CompiledMod | null,
): boolean {
  return options.some((o) => o.key === "tweakdefs") && !!compiled?.barTweakdefs;
}

/**
 * The `[modoptions]` entries the local BAR route adds. Empty when there is
 * nothing to tweak, so a caller can spread this over the rest of a launch's
 * mod options unconditionally.
 */
export function barTweakModOptions(
  compiled: CompiledMod | null,
): Record<string, string> {
  if (!compiled?.barTweakdefs) return {};
  return { tweakdefs: encodeTweakSlot(compiled.barTweakdefs) };
}
