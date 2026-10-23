import { describe, expect, it } from "vitest";
import type { SuggestedGame } from "@/content/branding";
import { decideGames, pageRelevance, type WizardContext } from "./relevance";

const g = (name: string) => ({ name }) as unknown as SuggestedGame;

describe("decideGames", () => {
  it("is unknown while candidates are unknown", () =>
    expect(decideGames({ candidates: null, hasGameFilter: false })).toBeNull());
  it("is none when nothing is offered", () =>
    expect(decideGames({ candidates: [], hasGameFilter: true })).toEqual({
      kind: "none",
    }));
  it("is auto when the filter resolves to one game", () =>
    expect(decideGames({ candidates: [g("SF")], hasGameFilter: true })).toEqual(
      { kind: "auto", game: g("SF") },
    ));
  it("is pick when the filter resolves to several", () =>
    expect(
      decideGames({ candidates: [g("A"), g("B")], hasGameFilter: true }),
    ).toEqual({ kind: "pick", games: [g("A"), g("B")] }));
  it("is pick for one featured game with no filter", () =>
    expect(decideGames({ candidates: [g("A")], hasGameFilter: false })).toEqual(
      { kind: "pick", games: [g("A")] },
    ));
});

const base: WizardContext = {
  languageStored: false,
  profileMode: false,
  profileColours: false,
  hubEnabled: true,
  hub: { loading: false, signedIn: false, unknown: false },
  lobbyAccountCount: 0,
  games: { kind: "pick", games: [g("A")] },
};

describe("pageRelevance", () => {
  it("everything relevant on a bare install", () =>
    expect(pageRelevance(base)).toEqual({
      language: true,
      appearance: true,
      games: true,
      hub: true,
      server: true,
    }));
  it("language: stored value", () =>
    expect(pageRelevance({ ...base, languageStored: true }).language).toBe(
      false,
    ));
  it("appearance: only irrelevant when the profile sets both", () => {
    expect(pageRelevance({ ...base, profileMode: true }).appearance).toBe(true);
    expect(pageRelevance({ ...base, profileColours: true }).appearance).toBe(
      true,
    );
    expect(
      pageRelevance({ ...base, profileMode: true, profileColours: true })
        .appearance,
    ).toBe(false);
  });
  it("games: auto and none are not pages, unknown is unknown", () => {
    expect(
      pageRelevance({ ...base, games: { kind: "auto", game: g("SF") } }).games,
    ).toBe(false);
    expect(pageRelevance({ ...base, games: { kind: "none" } }).games).toBe(
      false,
    );
    expect(pageRelevance({ ...base, games: null }).games).toBeNull();
  });
  it("hub: off, signed in, loading, unknown", () => {
    expect(pageRelevance({ ...base, hubEnabled: false }).hub).toBe(false);
    expect(
      pageRelevance({
        ...base,
        hub: { loading: false, signedIn: true, unknown: false },
      }).hub,
    ).toBe(false);
    expect(
      pageRelevance({
        ...base,
        hub: { loading: true, signedIn: false, unknown: false },
      }).hub,
    ).toBeNull();
    expect(
      pageRelevance({
        ...base,
        hub: { loading: false, signedIn: false, unknown: true },
      }).hub,
    ).toBe(true);
  });
  it("hub: disabled hub is irrelevant even while loading", () =>
    expect(
      pageRelevance({
        ...base,
        hubEnabled: false,
        hub: { loading: true, signedIn: false, unknown: false },
      }).hub,
    ).toBe(false));
  it("server: any saved login", () =>
    expect(pageRelevance({ ...base, lobbyAccountCount: 1 }).server).toBe(
      false,
    ));
});
