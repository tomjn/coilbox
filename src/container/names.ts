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
 * Singular, lowercase and article-free. The deep-link confirmation uses
 * {@link containerKindPhrase} instead, which carries its own article.
 */

import { i18n, type MessageDescriptor } from "@lingui/core";
import { msg, select, t } from "@lingui/core/macro";
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

/**
 * What a confirmation dialog calls one thing it is about to import. A kind, or
 * a challenge with its game mode, because the mode is in the payload rather
 * than in the kind.
 */
export type ContainerPhraseKey =
  | ContainerKind
  | "coilbox-campaign"
  | "conquest-challenge"
  | "warpath-challenge";

/**
 * A noun phrase with its article: "a campaign", or "a campaign for BA" when a
 * game is given.
 *
 * Each phrase is one message, so a translator can give it the article and
 * gender its language needs rather than having an English "a" put in front of
 * a translated name.
 */
export function containerKindPhrase(
  key: ContainerPhraseKey,
  gameName?: string,
): string {
  // ICU selector names cannot hold a hyphen.
  const kind = key.replaceAll("-", "_");
  if (gameName) {
    const game = gameName;
    return t`${select(kind, {
      campaign: `a campaign for ${game}`,
      coilbox_campaign: `a coilbox campaign for ${game}`,
      preset: `a singleplayer preset for ${game}`,
      challenge: `a challenge for ${game}`,
      conquest_challenge: `a conquest challenge for ${game}`,
      warpath_challenge: `a warpath challenge for ${game}`,
      setup_pack: `a setup pack for ${game}`,
      scenario: `a scenario for ${game}`,
      keymap: `a keymap for ${game}`,
      blueprint: `a base blueprint for ${game}`,
      mod_project: `a unit tweak project for ${game}`,
      module: `a unit builder module for ${game}`,
      other: `an import for ${game}`,
    })}`;
  }
  return t`${select(kind, {
    campaign: "a campaign",
    coilbox_campaign: "a coilbox campaign",
    preset: "a singleplayer preset",
    challenge: "a challenge",
    conquest_challenge: "a conquest challenge",
    warpath_challenge: "a warpath challenge",
    setup_pack: "a setup pack",
    scenario: "a scenario",
    keymap: "a keymap",
    blueprint: "a base blueprint",
    mod_project: "a unit tweak project",
    module: "a unit builder module",
    other: "an import",
  })}`;
}
