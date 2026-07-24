import { describe, expect, it } from "vitest";
import {
  type GameRepo,
  githubRepoForGame,
  mergeGameRepos,
  norm,
  repoForKey,
} from "./gameRepos";

const repo = (p: Partial<GameRepo> = {}): GameRepo => ({
  key: "a",
  label: "A",
  repo: "owner/a",
  nameKey: "a",
  ...p,
});

describe("norm", () => {
  it("lowercases, strips the archive extension and collapses separators", () => {
    expect(norm("Splinter Faction 0.1.72.sd7")).toBe("splinterfaction0.1.72");
    expect(norm("Metal_Factions.sdz")).toBe("metalfactions");
  });
});

describe("repoForKey", () => {
  it("finds the repo for a matching key", () => {
    const repos = [repo({ key: "a", repo: "owner/a" }), repo({ key: "b" })];
    expect(repoForKey(repos, "a")).toBe("owner/a");
  });

  it("returns undefined for an unknown key", () => {
    expect(repoForKey([repo()], "missing")).toBeUndefined();
  });
});

describe("githubRepoForGame", () => {
  it("matches by normalised name-key prefix, tolerant of a version suffix", () => {
    const repos = [repo({ nameKey: "splinterfaction", repo: "owner/sf" })];
    expect(githubRepoForGame(repos, "Splinter Faction 0.1.72")).toBe(
      "owner/sf",
    );
  });

  it("skips sources with an empty nameKey (browse-only, ambiguous name)", () => {
    const repos = [repo({ nameKey: "", repo: "owner/ambiguous" })];
    expect(githubRepoForGame(repos, "Ambiguous")).toBeUndefined();
  });

  it("returns undefined when no source matches", () => {
    expect(githubRepoForGame([repo({ nameKey: "a" })], "Something Else")).toBe(
      undefined,
    );
  });
});

describe("mergeGameRepos (issue #512)", () => {
  it("keeps catalog first, then fallback", () => {
    const merged = mergeGameRepos(
      [repo({ key: "cat" })],
      [repo({ key: "fallback" })],
    );
    expect(merged.map((g) => g.key)).toEqual(["cat", "fallback"]);
  });

  it("dedupes by key, catalog wins over the fallback seed", () => {
    const catalog = [repo({ key: "dup", repo: "owner/new" })];
    const fallback = [repo({ key: "dup", repo: "owner/old" })];
    const merged = mergeGameRepos(catalog, fallback);
    expect(merged).toHaveLength(1);
    expect(merged[0].repo).toBe("owner/new");
  });

  it("keeps a game declared in only the fallback (not yet migrated to the catalog)", () => {
    const catalog = [repo({ key: "in-catalog" })];
    const fallback = [repo({ key: "fallback-only" })];
    const merged = mergeGameRepos(catalog, fallback);
    expect(merged.map((g) => g.key).sort()).toEqual([
      "fallback-only",
      "in-catalog",
    ]);
  });

  it("keeps a game declared in only the catalog, not yet in the fallback seed", () => {
    const catalog = [repo({ key: "catalog-only" })];
    const merged = mergeGameRepos(catalog, []);
    expect(merged.map((g) => g.key)).toEqual(["catalog-only"]);
  });
});
