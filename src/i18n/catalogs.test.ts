import type { Messages } from "@lingui/core";
import { generateMessageId } from "@lingui/message-utils/generateMessageId";
import { describe, expect, it } from "vitest";
import { LOCALES, PSEUDO_LOCALE } from "./locales";

/**
 * Importing a catalog compiles it, and the Lingui plugin fails on a message
 * that does not compile, such as a placeholder missing its closing brace. The
 * app imports a catalog only when its language is picked, so this imports every
 * one to catch a broken translation before a player does.
 */
const catalogs = import.meta.glob<{ messages: Messages }>(
  "../locales/*/messages.po",
  { eager: true },
);

describe("translation catalogs", () => {
  it.each([...LOCALES, PSEUDO_LOCALE])("%s compiles", (code) => {
    const catalog = catalogs[`../locales/${code}/messages.po`];
    expect(catalog).toBeDefined();
    expect(Object.keys(catalog.messages).length).toBeGreaterThan(0);
  });
});

/**
 * English is written in sentence case, and its msgstr wins over the msgid, so a
 * title case msgstr overrides the name the code asks for (#5030).
 */
const SENTENCE_CASE_NAMES = [
  "Battle room",
  "Campaign builder",
  "Engine settings",
  "Lego parts",
  "Lua animations",
  "Mapping tools",
  "Mapping wiki",
  "My games",
  "My maps",
  "New games",
  "New maps",
  "Save games",
  "Scenario builder",
];

describe("English catalog", () => {
  const english = catalogs["../locales/en/messages.po"].messages;

  it.each(SENTENCE_CASE_NAMES)("shows %s as written", (name) => {
    expect(english[generateMessageId(name)]).toEqual([name]);
  });
});
