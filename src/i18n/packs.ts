import type { Messages } from "@lingui/core";
import { defineCommand } from "@picoframe/plugin-sdk";
import {
  isLocale,
  localeDisplayName,
  PSEUDO_LOCALE,
  SYSTEM_LANGUAGE,
} from "./locales";

/**
 * Language packs (#4598): a distribution profile ships a locale under
 * `.coilbox/locales/<code>/`, as a `pack.json` and the `messages.json` that
 * `lingui compile --namespace json` writes. A pack for a bundled locale is merged
 * over its catalog key by key, and a pack for any other code adds that language
 * to the picker. The Rust plugin only reads the two files, and this module
 * validates them. Both are data from a profile author, so the catalog is parsed
 * as JSON and checked against the shape Lingui compiles to, and never run.
 */

/** A pack that passed validation. */
export interface LocalePack {
  code: string;
  /** The language's name in its own language, as the picker lists it. */
  name: string;
  /**
   * Recorded for the right-to-left work in milestone 91. Nothing reads it
   * yet, so an `rtl` pack lays out left to right until then.
   */
  direction: "ltr" | "rtl";
  messages: Messages;
}

/** One pack folder that could not be used, and why. */
export interface PackFailure {
  dir: string;
  error: string;
}

/** One `.coilbox/locales/<dir>/` folder as the `profile_locales` command read it. */
export interface PackFiles {
  dir: string;
  pack: string;
  catalog: string;
  /** Why the Rust side could not read a file, or "" when it read both. */
  error: string;
}

const localesCmd = defineCommand<Record<string, never>, { packs: PackFiles[] }>(
  "coilbox-profile",
  "profile_locales",
);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Token types whose third element holds the choices of a compiled message. */
const CHOICE_TYPES = new Set(["plural", "select", "selectordinal"]);

/**
 * Whether `v` is a message as Lingui compiles it: an array of text and
 * placeholder tokens, with plural and select choices nested inside. Lingui
 * renders a malformed one by throwing, so a broken pack would otherwise take
 * down whatever screen first shows that string.
 */
function isCompiledMessage(v: unknown): boolean {
  if (typeof v === "string") return true;
  if (!Array.isArray(v)) return false;
  return v.every((token) => {
    if (typeof token === "string") return true;
    if (!Array.isArray(token) || token.length > 3) return false;
    const [name, type, format] = token;
    if (typeof name !== "string") return false;
    if (type != null && typeof type !== "string") return false;
    if (format == null || typeof format === "string") return true;
    if (!isRecord(format) || !CHOICE_TYPES.has(type)) return false;
    return Object.entries(format).every(([key, choice]) =>
      key === "offset" ? typeof choice === "number" : isCompiledMessage(choice),
    );
  });
}

/** Whether `code` is a BCP 47 tag `Intl` accepts, so formatting in it cannot throw. */
function isValidTag(code: string): boolean {
  try {
    return Intl.getCanonicalLocales(code).length === 1;
  } catch {
    return false;
  }
}

/** Validate one pack folder's files. */
export function parsePack(files: PackFiles): LocalePack | PackFailure {
  const fail = (error: string): PackFailure => ({ dir: files.dir, error });
  if (files.error) return fail(files.error);

  let meta: unknown;
  try {
    meta = JSON.parse(files.pack);
  } catch (e) {
    return fail(`pack.json is not valid JSON: ${String(e)}`);
  }
  if (!isRecord(meta)) return fail("pack.json is not a JSON object");
  const { code, name, direction = "ltr" } = meta;
  if (typeof code !== "string" || code !== files.dir) {
    return fail(`pack.json's code must be "${files.dir}", the folder's name`);
  }
  if (code === PSEUDO_LOCALE || code === SYSTEM_LANGUAGE || !isValidTag(code)) {
    return fail(`"${code}" is not a language code coilbox can use`);
  }
  if (typeof name !== "string" || name.trim() === "") {
    return fail("pack.json's name must be the language's name");
  }
  if (direction !== "ltr" && direction !== "rtl") {
    return fail('pack.json\'s direction must be "ltr" or "rtl"');
  }

  let catalog: unknown;
  try {
    catalog = JSON.parse(files.catalog);
  } catch (e) {
    return fail(`messages.json is not valid JSON: ${String(e)}`);
  }
  const messages = isRecord(catalog) ? catalog.messages : undefined;
  if (!isRecord(messages)) {
    return fail(
      "messages.json has no messages object. Write it with lingui compile --namespace json",
    );
  }
  const bad = Object.keys(messages).find(
    (id) => !isCompiledMessage(messages[id]),
  );
  if (bad !== undefined) {
    return fail(`messages.json's message ${bad} is not a compiled message`);
  }
  return { code, name, direction, messages: messages as Messages };
}

let packs = new Map<string, LocalePack>();
let failures: PackFailure[] = [];

/** Replace the loaded packs with what `files` validate to. */
export function applyLocalePacks(files: PackFiles[]): void {
  packs = new Map();
  failures = [];
  for (const f of files) {
    const parsed = parsePack(f);
    if ("error" in parsed) {
      console.warn(`i18n: language pack ${f.dir} not used: ${parsed.error}`);
      failures.push(parsed);
    } else {
      packs.set(parsed.code, parsed);
    }
  }
}

/**
 * Read the profile's language packs. Called once before the first catalog
 * loads. A failed read leaves coilbox with its bundled languages only.
 */
export async function loadLocalePacks(): Promise<void> {
  try {
    applyLocalePacks((await localesCmd({})).packs);
  } catch (e) {
    console.warn("i18n: could not read language packs", e);
    applyLocalePacks([]);
  }
}

/** The pack for `code`, if the profile ships one. */
export function getLocalePack(code: string): LocalePack | undefined {
  return packs.get(code);
}

/** Pack folders that could not be used, for the profile health panel. */
export function getLocalePackFailures(): PackFailure[] {
  return failures;
}

/** Every pack that loaded, by code. */
export function getLocalePackCodes(): string[] {
  return [...packs.keys()];
}

/** The codes packs add that coilbox does not bundle, sorted. */
export function packOnlyLocales(): string[] {
  return getLocalePackCodes()
    .filter((code) => !isLocale(code))
    .sort();
}

/** The picker's label for `code`: the pack's own name, when a pack ships one. */
export function languageLabel(code: string): string {
  return packs.get(code)?.name ?? localeDisplayName(code);
}
