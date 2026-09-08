/**
 * Packing a project across Beyond All Reason's numbered tweak slots, for a
 * player who does not control the host's own lobby (issue #1277).
 *
 * A mutator archive (`package.ts`) cannot be loaded into a BAR lobby, and
 * writing straight into a start script (`localBar.ts`) only works for a local
 * skirmish this machine is hosting. The route left for somebody joining
 * somebody else's lobby is asking the server to set a mod option through the
 * `!bset` chat command a SPADS-based autohost answers to, one per numbered
 * slot, because a real project does not fit in the one bare `tweakdefs`
 * option `localBar.ts` writes.
 *
 * The packing itself, minifying, ordering and slicing chunks to fit BAR's
 * per-slot character cap, happens in Rust (`bar_pack.rs`): the arithmetic is
 * shared with `compile.rs`'s own chunk list and is exactly the kind of thing
 * this project already tests in Rust rather than in TypeScript (see that
 * module's own doc comment). This file only wraps the command and compares
 * what it needed against what the selected game actually declares, which is
 * a fact `deliveryRoutes.ts`'s `tweakSlotCounts` already reads live off the
 * game rather than a number the packer could know on its own.
 */
import { defineCommand } from "@picoframe/plugin-sdk";
import type { ConfigOption } from "@/content/bindings";
import { tweakSlotCounts } from "./deliveryRoutes";
import type { ModProject } from "./project";

/** What packing a project's chunks across BAR's slots produced. */
export interface BarSlotPack {
  /** One `!bset tweakdefs...` line per filled slot, in the order they have
   *  to run. */
  tweakdefs: string[];
  /** One `!bset tweakunits...` line per filled slot. Always one chunk each. */
  tweakunits: string[];
  /** A chunk whose own line would exceed the cap even alone in an empty
   *  slot. Named by its title. */
  oversized: string[];
  /** A chunk that would have fit a slot on its own, but every slot BAR
   *  exposes was already spoken for by chunks compiled ahead of it. */
  unplaced: string[];
}

/**
 * Compile a project, check it, and pack it across BAR's numbered tweak
 * slots. Rejects the way `workshopPackageMutator` does when there is nothing
 * to pack or preflight finds a blocker: a lobby chat line going out to other
 * people is exactly the case a blocker should stop rather than only flag
 * (issue #2748). A chunk the packer could not place is not a rejection: it
 * comes back in `oversized`/`unplaced` so the caller can still offer the rest
 * and say what is missing, which is what issue #1277 asks for rather than
 * failing the whole export over one edit.
 */
export const workshopPackBarSlots = defineCommand<
  { project: ModProject },
  BarSlotPack
>("coilbox-workshop", "workshop_pack_bar_slots");

/** How many slots a pack actually used, by kind. */
export function barSlotsUsed(pack: BarSlotPack): {
  defs: number;
  units: number;
} {
  return { defs: pack.tweakdefs.length, units: pack.tweakunits.length };
}

/**
 * Whether the selected game declares enough tweak slots for what a pack
 * needed, checked against the live count `tweakSlotCounts` reads off the
 * game's own mod options rather than BAR's theoretical maximum of 30: a game
 * can, and BAR itself sometimes does, expose fewer than that. Reported before
 * the export rather than after, per issue #1277: a lobby chat line pasted
 * into a slot the game never declared does nothing, silently.
 */
export function barSlotFit(
  pack: BarSlotPack,
  options: ConfigOption[],
): {
  fits: boolean;
  needed: { defs: number; units: number };
  available: { defs: number; units: number };
} {
  const needed = barSlotsUsed(pack);
  const available = tweakSlotCounts(options);
  return {
    fits: needed.defs <= available.defs && needed.units <= available.units,
    needed,
    available,
  };
}
