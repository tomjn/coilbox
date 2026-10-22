import type { Messages } from "@lingui/core";
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
