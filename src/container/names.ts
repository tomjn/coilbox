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

import { i18n, type MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import type { ContainerKind } from "./container";

const KIND_NAMES: Record<ContainerKind, MessageDescriptor> = {
  campaign: msg`campaign`,
  preset: msg`singleplayer preset`,
  challenge: msg`challenge`,
  "setup-pack": msg`setup pack`,
  scenario: msg`scenario`,
  keymap: msg`keymap`,
  blueprint: msg`base blueprint`,
  "mod-project": msg`unit tweak project`,
  module: msg`unit builder module`,
};

/** Plurals are their own messages, because not every language adds an "s". */
const KIND_PLURALS: Record<ContainerKind, MessageDescriptor> = {
  campaign: msg`campaigns`,
  preset: msg`singleplayer presets`,
  challenge: msg`challenges`,
  "setup-pack": msg`setup packs`,
  scenario: msg`scenarios`,
  keymap: msg`keymaps`,
  blueprint: msg`base blueprints`,
  "mod-project": msg`unit tweak projects`,
  module: msg`unit builder modules`,
};

/** What to call one kind, for a sentence a person reads. */
export function containerKindName(kind: ContainerKind): string {
  return i18n._(KIND_NAMES[kind]);
}

/**
 * What to call more than one of a kind: "singleplayer presets".
 *
 * Lowercase like the singular, for a caller that wants it mid-sentence.
 */
export function containerKindPlural(kind: ContainerKind): string {
  return i18n._(KIND_PLURALS[kind]);
}

/**
 * Every kind, as the middle of a sentence: "a campaign, a singleplayer preset,
 * … or a base blueprint".
 *
 * One message, so a translator can give each kind its own article. The test
 * beside this file checks every kind in `CONTAINER_KINDS` is in it, so it
 * cannot fall behind what a box takes. "Or" rather than "and", because a paste
 * is one of them rather than all of them.
 */
export function containerKindsSentence(): string {
  return t`a campaign, a singleplayer preset, a challenge, a setup pack, a scenario, a keymap, a base blueprint, a unit tweak project or a unit builder module`;
}
