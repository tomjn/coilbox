/**
 * Deleting one of several installed versions from the Versions tab used to send
 * the user back to the games catalogue every time.
 */
import { describe, expect, it } from "vitest";
import type { GameItem } from "./bindings";
import { BA_GAME } from "./fixtures/gamePage";
import { afterVersionRemoved, type GameVersionRow } from "./gameVersionRows";

const item = (name: string): GameItem => ({ ...BA_GAME.installed[0], name });
const rowFor = (installedItem?: GameItem): GameVersionRow => ({
  key: "k",
  version: "v",
  from: "ba:stable",
  kind: "release",
  pkg: "p",
  needs: [],
  installed: true,
  installedItem,
  request: null,
});

const OLD = item("Balanced Annihilation V15.9.7");
const CURRENT = item("Balanced Annihilation V15.9.8");
const NEWER = item("Balanced Annihilation V15.9.9");

describe("afterVersionRemoved", () => {
  it("stays on the page when another version is deleted", () => {
    expect(
      afterVersionRemoved(rowFor(OLD), CURRENT.name, [OLD, CURRENT, NEWER]),
    ).toBeNull();
  });

  it("moves to another installed version when the shown one is deleted", () => {
    expect(
      afterVersionRemoved(rowFor(CURRENT), CURRENT.name, [CURRENT, NEWER]),
    ).toBe("/library/games/Balanced%20Annihilation%20V15.9.9");
  });

  it("goes to the catalogue when the last version is deleted", () => {
    expect(afterVersionRemoved(rowFor(CURRENT), CURRENT.name, [CURRENT])).toBe(
      "/library/games",
    );
  });

  it("leaves the page when it cannot tell which version was deleted", () => {
    expect(afterVersionRemoved(rowFor(), CURRENT.name, [CURRENT])).toBe(
      "/library/games",
    );
  });
});
