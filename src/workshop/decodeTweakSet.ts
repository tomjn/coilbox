/**
 * Decoding a base64 tweak payload back to Lua (issue #1280).
 *
 * The inverse of `barPack.ts` (issue #1277): that file wraps the command that
 * packs a project into `!bset` lines, this one wraps the command that reads
 * one, or a whole set of a battle's mod options, back out. The decoding
 * itself, classification, size cap and everything about which payloads are
 * safe to actually evaluate, lives in Rust
 * (`crates/tauri-plugin-coilbox-workshop/src/decode.rs`). This file only
 * wraps the command and turns a "table" slot into the project pieces the
 * decode drawer can offer: new units for the ones with a shape, and
 * read-only Lua for the ones without.
 */
import { defineCommand } from "@picoframe/plugin-sdk";
import { checkCloneName, type UnitClone } from "./clones";
import type { ReadOnlyLuaBlock } from "./readOnlyLua";

/** Which BAR mod option a slot's key names. */
export type SlotKind = "tweakdefs" | "tweakunits" | "unknown";

/** What decoding one payload found, matching `decode.rs`'s `DecodedSlot`. */
export interface DecodedSlot {
  key: string;
  kind: SlotKind;
  slot: number | null;
  lua: string | null;
  manifest: string | null;
  form: "table" | "block" | "unrecognised" | null;
  table: Record<string, unknown> | null;
  error: string | null;
}

/** Every slot decode found, bucketed by kind and ordered by slot number. */
export interface DecodedTweakSet {
  tweakdefs: DecodedSlot[];
  tweakunits: DecodedSlot[];
  unrecognised: DecodedSlot[];
}

/**
 * Decode a payload, or a whole set of slots read from a battle's mod
 * options. `entries` is a key to raw pasted text map: a real mod-options set
 * (`tweakdefs`, `tweakunits3`, ...), a single ad hoc paste under the key
 * `"pasted"`, or both. A key this does not recognise as a tweak slot is
 * ignored rather than reported on.
 */
export const workshopDecodeTweakSet = defineCommand<
  { entries: Record<string, string> },
  DecodedTweakSet
>("coilbox-workshop", "workshop_decode_tweak_set");

/** The map a single pasted payload becomes, for `workshopDecodeTweakSet`. */
export function pastedEntry(text: string): Record<string, string> {
  return { pasted: text };
}

/**
 * Split a multi-line paste into entries, for "a whole set of slots" copied
 * out of a lobby's mod options at once (issue #1280).
 *
 * Each line is read on its own, in whichever of the three shapes it arrives
 * in: a whole `!bset tweakdefs3 <payload>` line (the key comes off its own
 * prefix, so the map key here does not have to be right), a `key=value`
 * pair copied out of an options list, or a bare payload with nothing naming
 * it. A bare line gets a key of its own (`pasted-0`, `pasted-1`, ...), so
 * two bare lines never collide as the same entry. The decoder still
 * recovers a real key from an embedded `!bset` prefix when one is there.
 */
export function multiLineEntries(text: string): Record<string, string> {
  const entries: Record<string, string> = {};
  let bare = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("!bset ")) {
      entries[`pasted-${bare++}`] = line;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq > 0) {
      entries[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      continue;
    }
    entries[`pasted-${bare++}`] = line;
  }
  return entries;
}

/** Every slot a decode found, across all three buckets, in report order. */
export function allSlots(set: DecodedTweakSet): DecodedSlot[] {
  return [...set.tweakdefs, ...set.tweakunits, ...set.unrecognised];
}

/** A heading for a slot: its manifest fingerprint if it has one, else its
 *  key, so a card never shows nothing at all. */
export function slotTitle(slot: DecodedSlot): string {
  return slot.manifest ?? slot.key;
}

/**
 * What starting a project from a decoded set would create: a clone per unit
 * a "table" slot evaluated to, and a read-only block per slot that was
 * either a program or could not be classified at all.
 *
 * Every table entry becomes a new unit rather than a patch against an
 * existing one: nothing here has scanned a game, so there is no way to know
 * whether a key already names a unit in it, and guessing wrong either way is
 * worse than the honest default. `checkCloneName` still screens the key the
 * way the clone editor does, so an invalid one is left out and counted
 * rather than silently breaking the compile later. The user can mark
 * "replaces game unit" afterwards in the editor once they can see the
 * game's own list.
 */
export function planProjectFromDecoded(set: DecodedTweakSet): {
  clones: UnitClone[];
  readOnlyLua: ReadOnlyLuaBlock[];
  skippedKeys: string[];
} {
  const clones: UnitClone[] = [];
  const readOnlyLua: ReadOnlyLuaBlock[] = [];
  const skippedKeys: string[] = [];
  // Tracked across every slot, not reset per slot, so two slots naming the
  // same unit do not both add it: `checkCloneName` already refuses to
  // overwrite a clone this same batch just created.
  let claimed: Record<string, UnitClone> = {};

  for (const slot of allSlots(set)) {
    if (slot.form === "table" && slot.table) {
      for (const [rawKey, def] of Object.entries(slot.table)) {
        const check = checkCloneName(rawKey, {}, claimed);
        if (!check.ok || typeof def !== "object" || def === null) {
          skippedKeys.push(rawKey);
          continue;
        }
        const clone: UnitClone = {
          key: check.key,
          replacesGameUnit: false,
          def: def as Record<string, unknown>,
        };
        clones.push(clone);
        claimed = { ...claimed, [check.key]: clone };
      }
      continue;
    }
    if (!slot.lua) continue; // `slot.error` already says why nothing decoded.
    const note =
      slot.form === "block"
        ? "Decoded as a program (loops or conditionals), not a data table, so it is shown as Lua rather than turned into edits."
        : slot.error
          ? slot.error
          : "This slot did not decode to a shape coilbox could read into a project, so it is shown as Lua rather than turned into edits.";
    readOnlyLua.push({ title: slotTitle(slot), lua: slot.lua, note });
  }

  return { clones, readOnlyLua, skippedKeys };
}
