/**
 * Which of the two delivery routes a game actually supports (issue #1268).
 *
 * A change lands in a game one of two ways, and they are not equivalent. The
 * engine's own route is a mutator archive: a `.sdd`/`.sdz` whose `modinfo.lua`
 * depends on the base game and supplies only what changed. It needs no
 * cooperation from the base game and works for every Spring and Recoil game
 * there is, which is why `crates/tauri-plugin-coilbox-scenario/src/mutator.rs`
 * already writes one and why the compiler in #1275 targets it first.
 *
 * The tweak-slot route is different. A `tweakdefs`/`tweakunits` mod option
 * carries base64 Lua, which the game's own code decodes and applies. That is
 * a policy choice each game makes, not an engine mechanism, so it is only on
 * offer when the game actually declares the slots. unitsync already reads
 * every mod option a game's `modoptions.lua` declares
 * (`GameInfoResult.options`, via `unitsync_game_info`). Zero-K and Beyond All
 * Reason, the two installed games that declare them, generate the same keys
 * with the same loop: a bare `tweakdefs`/`tweakunits` plus numbered ones,
 * `1..9` in Zero-K and older BAR builds and `1..29` in BAR since September
 * 2026. The packer fills only `tweakdefs` slots, because those two games do
 * not agree on how to decode a `tweakunits` slot or when to run it
 * (issue #3126, set out in `tweak_pack.rs`). No other game's decoder has been
 * read, so the route says so for any game that is not one of those two
 * (`tweakSlotsChecked`).
 *
 * The mutator route is the default that always works. The tweak-slot route is
 * additional, and only when the game says so.
 *
 * Edit-in-place (issue #2631) is a third: writing the change straight into
 * the game's own files rather than a generated mutator or a lobby slot,
 * offered only when the selected game is a loose `.sdd` directory under a
 * content root's `games` folder, since that is the only shape a rewrite in
 * place can safely target (`isEditInPlaceEligible` in `content/format.ts`
 * mirrors the Rust guard in `inplace.rs` that enforces it). This module only
 * offers and explains the route. The write, its backups and undo are
 * `inPlace.ts` (issue #2635), reached from the checks drawer.
 */
import type { ConfigOption } from "@/content/bindings";
import { isEditInPlaceEligible } from "@/content/format";

/** One of the three ways a project's edits can reach a running game. */
export type DeliveryRoute = "mutator" | "tweak-slots" | "edit-in-place";

/** How many tweak slots a game's mod options declare, by kind. */
export interface TweakSlotCounts {
  defs: number;
  units: number;
}

/**
 * `tweakdefs`, `tweakunits`, or either with a number after it, the exact
 * shape Zero-K's and BAR's `modoptions.lua` declare: bare for the one slot
 * in the main options list, and numbered for the ones a loop adds after it.
 * A game that copies the convention for its own slots reads the same way.
 */
const TWEAK_KEY = /^tweak(defs|units)(\d+)?$/;

/**
 * Whether a bare mod option key is a tweak slot, by key shape alone.
 *
 * `tweakSlotOptions` below answers the same question from a game's declared
 * options, which is what a caller wanting each slot's default needs. A caller
 * holding only the values, such as a saved preset's `modOptionValues`, has no
 * schema to consult and would otherwise match the key shape in a second place.
 * Splitting a preset's options this way therefore works for a game that is not
 * installed, which is the normal case when browsing shared presets.
 */
export function isTweakSlotKey(key: string): boolean {
  return TWEAK_KEY.test(key);
}

/** Count a game's declared tweak slots, split by which kind of Lua they carry. */
export function tweakSlotCounts(options: ConfigOption[]): TweakSlotCounts {
  let defs = 0;
  let units = 0;
  for (const o of options) {
    const m = TWEAK_KEY.exec(o.key);
    if (!m) continue;
    if (m[1] === "defs") defs += 1;
    else units += 1;
  }
  return { defs, units };
}

/**
 * The game's own declared tweak-slot options, for a caller that wants each
 * one's current value rather than just the count (issue #2756): a battle
 * room reading what its host has already set has to know which of a game's
 * mod options are tweak slots at all, and this is the one place that already
 * knows the key shape, so it answers that rather than leaving another
 * caller to match key names of its own.
 */
export function tweakSlotOptions(options: ConfigOption[]): ConfigOption[] {
  return options.filter((o) => TWEAK_KEY.test(o.key));
}

/**
 * The games whose own tweak-slot decoding has been read and loaded with
 * packed slots (issue #3126), matched by the start of the game's name so
 * every version counts. What was checked, and how the versions differ, is in
 * `tweak_pack.rs`.
 */
const CHECKED_TWEAK_SLOT_GAMES = ["Beyond All Reason", "Zero-K"];

/** Whether `gameName` is one of the games the tweak-slot route was checked
 *  against. */
export function tweakSlotsChecked(gameName: string): boolean {
  return CHECKED_TWEAK_SLOT_GAMES.some((name) => gameName.startsWith(name));
}

/**
 * The sentence to show beside the tweak-slot route for a game it was never
 * checked against, or `null` for one it was.
 */
export function tweakSlotsUncheckedNote(gameName: string): string | null {
  return tweakSlotsChecked(gameName)
    ? null
    : `Coilbox has checked this route against Beyond All Reason's and Zero-K's own code only. How ${gameName} reads a tweakdefs slot is unverified, so check the changes in game.`;
}

/** One route, whether the selected game supports it, and why when it does not. */
export interface RouteAvailability {
  route: DeliveryRoute;
  label: string;
  available: boolean;
  /** A line of detail worth showing either way: capacity when available,
   *  cause when it is not. */
  detail: string;
}

/**
 * The three routes for one game, in the order they are offered. The mutator is
 * always available. It is the one every game supports, and the one nothing
 * here needs to check. The tweak-slot route is available only when the game's
 * own mod options declare at least one `tweakdefs` slot, the only kind the
 * packer fills. The edit-in-place route is available only
 * when `gamePath` is a loose `.sdd` directly under a content root's `games`
 * folder. Omitted, it reads as not eligible, which is right for a caller such
 * as a battle preset that has no installed game path to check.
 */
export function deliveryRoutes(
  options: ConfigOption[],
  gameName: string,
  gamePath?: string,
  /**
   * Whether the project holds any custom explosion generator (issue #2643).
   * The engine loads a CEG from a real file under `effects/` in the game's
   * own archive tree, which a tweak slot has no way to carry, so a project
   * with one of these gets no tweak-slots route regardless of what the game
   * declares: it would otherwise offer a route that writes the field naming
   * the generator, with no way to deliver the generator itself.
   */
  hasExplosionGenerators?: boolean,
): RouteAvailability[] {
  const { defs } = tweakSlotCounts(options);
  const available = defs > 0 && !hasExplosionGenerators;
  const unchecked = tweakSlotsUncheckedNote(gameName);
  const inPlace = isEditInPlaceEligible(gamePath);
  return [
    {
      route: "mutator",
      label: "Mutator archive",
      available: true,
      detail:
        "Works for every game: a generated game that depends on this one and supplies only what the project changes.",
    },
    {
      route: "tweak-slots",
      label: "Tweak slots",
      available,
      detail: hasExplosionGenerators
        ? "This project has a custom explosion effect, and the engine only reads one from a real file, which a tweak slot cannot carry. The mutator and edit-in-place routes below still work."
        : available
          ? `${gameName} declares ${defs} tweakdefs slot${defs === 1 ? "" : "s"} for base64 Lua.${unchecked ? ` ${unchecked}` : ""}`
          : `${gameName} does not declare any tweakdefs mod options, so there is no slot to carry base64 Lua. The mutator route above still works.`,
    },
    {
      route: "edit-in-place",
      label: "Edit in place",
      available: inPlace,
      detail: inPlace
        ? `${gameName} is a loose .sdd game under a content root's games folder, so field changes can be written straight into its own unit files. Coilbox keeps the original of each file it changes until you undo or accept.`
        : `${gameName} is not a loose .sdd game directly under a content root's games folder, so its files cannot be rewritten in place. The mutator route above still works.`,
    },
  ];
}
