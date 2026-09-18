/**
 * Lua a project carries but does not edit (issue #1280).
 *
 * A decoded tweak set does not always come apart into fields. A `tweakdefs`
 * slot full of loops and conditionals is a program, not a data structure, and
 * turning it into overrides or a build menu would mean guessing what it does
 * and showing the guess as though it were the thing itself. The honest
 * answer is to keep the Lua and say plainly that this part of the project
 * cannot be edited here.
 *
 * Not editable is not the same as not compiled. A decoded set is mostly
 * program: the whole point of importing somebody's tweak set is to run it,
 * and a project that dropped it would keep the small editable part and lose
 * the rest. So a block the decoder proved is a valid Lua chunk is compiled
 * verbatim into the output, ahead of the project's own edits, and coilbox
 * still never runs it itself. A block that never parsed cannot be, because
 * emitting it would break every file it landed in.
 *
 * This is why it is not a sixth store beside the five in {@link GameEdits}.
 * Those five are all edits: a patch, a copy, a menu operation, a word, a
 * mark. A read-only block is none of those, so it lives on {@link ModProject}
 * itself, the way `distributionVersion` does, rather than inside `edits`
 * where `editSlot` could be asked to write to it. Nothing in this project
 * offers a way to change one after it is created. The only path that writes
 * one is importing a decoded tweak set (`decodeTweakSet.ts`).
 */

/** One block of Lua a project shows but cannot edit. */
export interface ReadOnlyLuaBlock {
  /** What this block is, for its heading: a slot name, a manifest line, or
   *  just "decoded Lua" when neither is known. */
  title: string;
  /** The decoded Lua, verbatim. Never re-serialised, never executed. */
  lua: string;
  /** Why it could not be read into an editable store, in the user's own
   *  terms rather than a flag. */
  note: string;
  /** What the decoder made of it, mirroring `DecodedSlot.form`. `"block"`
   *  means it compiled as a Lua chunk, which is what lets the compiler emit
   *  it verbatim. Absent on a project saved before this was recorded, which
   *  is read as "not known to parse" and so not compiled. */
  form?: "block" | "unrecognised";
}

/** Whether a block can be compiled into the output: only one the decoder
 *  proved is a valid Lua chunk. */
export function compilesVerbatim(block: ReadOnlyLuaBlock): boolean {
  return block.form === "block";
}

/** How many read-only blocks a project carries, for a header that says so. */
export function readOnlyLuaCount(
  blocks: ReadOnlyLuaBlock[] | undefined,
): number {
  return blocks?.length ?? 0;
}
