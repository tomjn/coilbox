/**
 * What each kind a container can hold is called (issue #1515).
 *
 * The names existed only inside `../deeplink/actions.ts`, written into each arm
 * of the switch that routes an import, so the only way to learn what a
 * `setup-pack` is called was to build the plan that carried one. A screen that
 * wanted to say what it accepts wrote the list out by hand instead, and both
 * hand written lists had fallen behind the kinds by the time anybody read them.
 *
 * A file of its own rather than an export in `./container.ts`, because that file
 * is vendored into tomjn/coilbox-hub by blob hash and a name a person reads is
 * not part of the format.
 *
 * Singular, lowercase and article-free, because that is what the deep-link
 * confirmation does with them: `../deeplink/readImport.ts` says "a {name}" and
 * "a {name} for {game}". A challenge's own arm still says which of the two it
 * is, since the mode is in the payload rather than in the kind.
 */

import { CONTAINER_KINDS, type ContainerKind } from "./container";

const KIND_NAMES: Record<ContainerKind, string> = {
  campaign: "campaign",
  preset: "singleplayer preset",
  challenge: "challenge",
  "setup-pack": "setup pack",
  scenario: "scenario",
  keymap: "keymap",
  blueprint: "base blueprint",
};

/** What to call one kind, for a sentence a person reads. */
export function containerKindName(kind: ContainerKind): string {
  return KIND_NAMES[kind];
}

/**
 * What to call more than one of a kind: "singleplayer presets".
 *
 * Every name above is a regular noun, so a plain "s" is right for all of them.
 * Lowercase like the singular, for a caller that wants it mid-sentence. A
 * caller that wants it to open one raises the first letter itself.
 */
export function containerKindPlural(kind: ContainerKind): string {
  return `${containerKindName(kind)}s`;
}

/**
 * Every kind, as the middle of a sentence: "a campaign, a singleplayer preset,
 * … or a base blueprint".
 *
 * Built from {@link CONTAINER_KINDS} so a box saying what it takes cannot fall
 * behind what it takes. "Or" rather than "and", because a paste is one of them
 * rather than all of them.
 */
export function containerKindsSentence(): string {
  const said = CONTAINER_KINDS.map((kind) => `a ${containerKindName(kind)}`);
  const last = said.pop();
  return last === undefined ? "" : `${said.join(", ")} or ${last}`;
}
