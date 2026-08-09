/**
 * Work out what somebody just pasted, for the one import box (issue #1333).
 *
 * Coilbox Hub hands out `coilbox://import?url=…` links, and a link does nothing
 * when the scheme has no registered handler: anyone who has not installed
 * coilbox, and on some setups anyone who installed it but never launched it. The
 * hub falls back to showing the URL with a copy button, which only helps if
 * there is somewhere in coilbox to paste it. Until now there was not: a challenge
 * code went in the challenge screen, a pack code in the pack screen, a scenario
 * in the scenario screen, and somebody holding a link off a website has no way to
 * know which of those they have.
 *
 * This is the classifier behind that one box. It takes any of the forms coilbox
 * produces - a `coilbox://` link of any shape, a bare share code, the text of an
 * exported `.json`, a file's contents, or the https address of a hub share - and
 * answers with one of three things: a plan to confirm, a link to hand to the
 * deep-link handler, or a sentence saying what the paste actually is.
 *
 * It reimplements nothing. {@link identify} already works out the kind, the
 * schema version, whether this build can read it and any warnings, and
 * {@link prepareImport} already maps a recognised kind to its importer route.
 * The only new work here is picking the right sentence when the answer is no,
 * because "not valid" is useless to somebody who does not know what they are
 * holding.
 *
 * A `coilbox://import?code=` link unwraps to its code and takes the same path as
 * a bare code, so the box owns one confirmation and one error surface. Every
 * other link shape (a `join`, an `open`, or an `import?url=` that needs the
 * fetch-and-confirm flow) goes to `DeepLinkHandler` unchanged, which already
 * owns those. A pasted https address becomes an `import?url=` link and joins
 * them, so downloading someone else's URL keeps the two-step consent it already
 * has and gains nothing new.
 */

import { COMPRESSED_CODE_PREFIX, identify } from "../container/container";
import type { GameIdentity } from "../container/gameIdentity";
import { type ImportPlan, prepareImport } from "./actions";
import { parseDeepLink } from "./parse";

export type ReadImportResult =
  /** Recognised and routable. `phrase` names it, for example "a warpath
   * challenge for BA". */
  | { outcome: "confirm"; phrase: string; plan: ImportPlan }
  /** A `coilbox://` link the deep-link handler should take from here. */
  | { outcome: "link"; url: string }
  /** Not something this box can import, and a sentence saying what it is. */
  | { outcome: "rejected"; reason: string };

const WEB_URL = /^https?:\/\//i;
const COILBOX_LINK = /^coilbox:/i;

/** Name a container as a noun phrase, so one wording serves both "This is …"
 * and "Your clipboard holds …". */
function phraseFor(label: string, game?: GameIdentity): string {
  // The archive name pins a build and is the more useful of the two. The
  // shortname is all a challenge ever carries.
  const name = game?.name ?? game?.shortname;
  return name ? `a ${label} for ${name}` : `a ${label}`;
}

/** True when the text parses as JSON, which separates "not a coilbox file" from
 * "not a file at all". */
function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** The sentence for something `identify` did not recognise. Each case says what
 * the paste actually is, because a validation failure tells the reader nothing
 * they can act on. */
function unrecognised(text: string): string {
  if (text.startsWith(COMPRESSED_CODE_PREFIX)) {
    return "That starts like a coilbox code, but the rest is damaged or cut short. Copy the whole code and paste it again.";
  }
  if (isJson(text)) {
    return 'That is a JSON file, but not one coilbox made. A coilbox export starts with a "format": "coilbox" line.';
  }
  return "Coilbox does not recognise that. Paste a coilbox link, a share code, or the contents of a coilbox .json file.";
}

/** Classify a code or an export's text: everything except a link. */
function readContainerText(text: string): ReadImportResult {
  const id = identify(text);

  // A newer container is refused here rather than routed with a warning, unlike
  // a deep link: the importer would only fail on it a screen later, and this box
  // exists to say what something is up front.
  if (id.compatibility === "newer") {
    return {
      outcome: "rejected",
      reason:
        id.warnings[0] ??
        "This was made by a newer version of coilbox. Update coilbox to open it.",
    };
  }

  if (id.kind === "unknown") {
    return { outcome: "rejected", reason: unrecognised(text) };
  }

  // Campaigns are recognised but import from a file in the builder, which sits
  // behind Advanced mode. Say so, rather than routing to a screen that will not
  // take a code (issue #1333 keeps campaign code import out of scope).
  if (id.kind === "campaign") {
    return {
      outcome: "rejected",
      reason: `This is ${phraseFor("coilbox campaign", id.game)}. Campaigns import from a file: turn on Advanced mode in Settings, then use Campaign Builder and its Import button.`,
    };
  }

  const prepared = prepareImport(text);
  if (!prepared.ok) return { outcome: "rejected", reason: prepared.reason };
  return {
    outcome: "confirm",
    phrase: phraseFor(prepared.plan.label, id.game),
    plan: prepared.plan,
  };
}

/**
 * Work out what a paste is. Never throws: every rejection carries a sentence
 * meant to be shown as-is.
 */
export function readImport(input: string): ReadImportResult {
  const text = input.trim();
  if (text === "") {
    return {
      outcome: "rejected",
      reason:
        "Paste a coilbox link, a share code, or the contents of a coilbox .json file.",
    };
  }

  if (COILBOX_LINK.test(text)) return readLink(text);

  // Coilbox Hub serves a share's container JSON straight off its item URL, so a
  // pasted https address is worth going and looking at. Nothing distinguishes
  // one of those from any other web page without asking, so it takes the
  // fetch-URL route: the handler confirms contacting the host, downloads under
  // a byte cap, and only then says what came back. No request happens here.
  if (WEB_URL.test(text)) {
    return readLink(`coilbox://import?url=${encodeURIComponent(text)}`);
  }

  return readContainerText(text);
}

/** Classify a `coilbox://` link, including one wrapped around a pasted URL. */
function readLink(url: string): ReadImportResult {
  const link = parseDeepLink(url);
  if (link.kind === "invalid") {
    return { outcome: "rejected", reason: link.reason };
  }
  // An inline code is the same thing as a pasted code, so unwrap it and keep
  // one confirmation. Everything else is the deep-link handler's job.
  if (link.kind === "import" && link.source.type === "code") {
    return readContainerText(link.source.code);
  }
  return { outcome: "link", url };
}

/**
 * What the clipboard is holding, phrased as an offer, or `null` when it is not
 * worth mentioning.
 *
 * The box offers what it finds rather than filling itself in: reading the
 * clipboard is a permissions question on some platforms, and silently pasting
 * somebody's clipboard into a form is a surprise even when it works.
 */
export function clipboardOffer(text: string): string | null {
  if (typeof text !== "string" || text.trim() === "") return null;
  const trimmed = text.trim();
  // A bare web address could be anything, and only a fetch would tell. Having a
  // URL in your clipboard is not a reason to offer to download it.
  if (!COILBOX_LINK.test(trimmed) && WEB_URL.test(trimmed)) return null;
  const result = readImport(trimmed);
  if (result.outcome === "confirm") {
    return `Your clipboard holds ${result.phrase}.`;
  }
  if (result.outcome === "link") return "Your clipboard holds a coilbox link.";
  return null;
}
