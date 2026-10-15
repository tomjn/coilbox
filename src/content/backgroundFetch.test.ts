import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  loadRecoilEngines: vi.fn(),
  loadSpringfilesEngines: vi.fn(),
  loadSpringfilesList: vi.fn(),
  loadHakoraMaps: vi.fn(),
  loadEvolutionRtsMaps: vi.fn(),
  loadGithubReleases: vi.fn(),
  loadHubGames: vi.fn(),
  loadSuggestedGames: vi.fn(),
  loadGithubGameRepos: vi.fn(),
  hidden: new Set<string>(),
  // The hub account and the keychain read behind it, which the job must never use.
  askHubWhoWeAre: vi.fn(),
  recheckHubAccount: vi.fn(),
  signInToHub: vi.fn(),
  hubAccount: vi.fn(),
  hubSignIn: vi.fn(),
}));

vi.mock("../downloads/engineLists", () => ({
  loadRecoilEngines: m.loadRecoilEngines,
  loadSpringfilesEngines: m.loadSpringfilesEngines,
}));
vi.mock("../downloads/mirrorIndex", () => ({
  loadSpringfilesList: m.loadSpringfilesList,
  loadHakoraMaps: m.loadHakoraMaps,
  loadEvolutionRtsMaps: m.loadEvolutionRtsMaps,
}));
vi.mock("../downloads/githubReleases", () => ({
  loadGithubReleases: m.loadGithubReleases,
}));
vi.mock("../hub/gameIcons", () => ({ loadHubGames: m.loadHubGames }));
vi.mock("./branding", () => ({
  loadSuggestedGames: m.loadSuggestedGames,
  loadGithubGameRepos: m.loadGithubGameRepos,
}));
vi.mock("../profile/hidden", () => ({
  isProfileHidden: (id: string) => m.hidden.has(id),
}));
vi.mock("../hub/account", () => ({
  askHubWhoWeAre: m.askHubWhoWeAre,
  recheckHubAccount: m.recheckHubAccount,
  signInToHub: m.signInToHub,
}));
vi.mock("../hub/auth", () => ({
  hubAccount: m.hubAccount,
  hubSignIn: m.hubSignIn,
}));

const { fetchListsInBackground } = await import("./backgroundFetch");

const hubUrl = "https://hub.example";
const githubGame = (repo: string) => ({
  download: { kind: "github", repo },
});

beforeEach(() => {
  vi.clearAllMocks();
  m.hidden.clear();
  for (const fn of [
    m.loadRecoilEngines,
    m.loadSpringfilesEngines,
    m.loadSpringfilesList,
    m.loadHakoraMaps,
    m.loadEvolutionRtsMaps,
    m.loadGithubReleases,
    m.loadHubGames,
  ]) {
    fn.mockResolvedValue({});
  }
  m.loadSuggestedGames.mockResolvedValue([
    githubGame("a/one"),
    { download: { kind: "url", url: "https://x.example/g.sdz" } },
    githubGame("b/two"),
  ]);
  m.loadGithubGameRepos.mockResolvedValue([]);
});

describe("fetchListsInBackground", () => {
  it("calls each loader once", async () => {
    await fetchListsInBackground({ enabled: true, hubUrl });
    expect(m.loadSpringfilesList.mock.calls).toEqual([["map"], ["game"]]);
    expect(m.loadHakoraMaps).toHaveBeenCalledTimes(1);
    expect(m.loadEvolutionRtsMaps).toHaveBeenCalledTimes(1);
    expect(m.loadRecoilEngines).toHaveBeenCalledTimes(1);
    expect(m.loadSpringfilesEngines).toHaveBeenCalledTimes(1);
    expect(m.loadHubGames).toHaveBeenCalledExactlyOnceWith(hubUrl, false);
  });

  it("asks for the release list of each GitHub game the catalog names", async () => {
    await fetchListsInBackground({ enabled: true, hubUrl });
    expect(m.loadGithubReleases.mock.calls.map((c) => c[0])).toEqual([
      "a/one",
      "b/two",
    ]);
  });

  it("drops a rejection and carries on with the rest", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const fn of [
      m.loadSpringfilesList,
      m.loadHakoraMaps,
      m.loadRecoilEngines,
      m.loadGithubReleases,
    ]) {
      fn.mockRejectedValue(new Error("offline"));
    }
    await expect(
      fetchListsInBackground({ enabled: true, hubUrl }),
    ).resolves.toBeUndefined();
    expect(m.loadEvolutionRtsMaps).toHaveBeenCalledTimes(1);
    expect(m.loadSpringfilesEngines).toHaveBeenCalledTimes(1);
    expect(m.loadGithubReleases).toHaveBeenCalledTimes(2);
    expect(m.loadHubGames).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    error.mockRestore();
    warn.mockRestore();
  });

  it("survives the catalog failing to load", async () => {
    m.loadSuggestedGames.mockRejectedValue(new Error("offline"));
    await expect(
      fetchListsInBackground({ enabled: true, hubUrl }),
    ).resolves.toBeUndefined();
    expect(m.loadHubGames).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the setting is off", async () => {
    await fetchListsInBackground({ enabled: false, hubUrl });
    for (const fn of [
      m.loadRecoilEngines,
      m.loadSpringfilesEngines,
      m.loadSpringfilesList,
      m.loadHakoraMaps,
      m.loadEvolutionRtsMaps,
      m.loadGithubReleases,
      m.loadHubGames,
      m.loadSuggestedGames,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("skips the hub games list when the profile hides the hub", async () => {
    await fetchListsInBackground({ enabled: true, hubUrl: null });
    expect(m.loadHubGames).not.toHaveBeenCalled();
    expect(m.loadHakoraMaps).toHaveBeenCalledTimes(1);
  });

  it("skips the springfiles game list when the profile hides game downloads", async () => {
    m.hidden.add("downloads.games");
    await fetchListsInBackground({ enabled: true, hubUrl });
    expect(m.loadSpringfilesList.mock.calls).toEqual([["map"]]);
  });

  it("never touches the hub account or the keychain", async () => {
    await fetchListsInBackground({ enabled: true, hubUrl });
    for (const fn of [
      m.askHubWhoWeAre,
      m.recheckHubAccount,
      m.signInToHub,
      m.hubAccount,
      m.hubSignIn,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
