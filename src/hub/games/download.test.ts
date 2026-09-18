import { afterEach, describe, expect, it, vi } from "vitest";
import type { HubGameDownload } from "../api";

const dlGithubReleaseArchives = vi.hoisted(() => vi.fn());

vi.mock("../../downloads/bindings", () => ({ dlGithubReleaseArchives }));

const { hubGameDownloadRequest } = await import("./download");

const DEST = "/content/games";

afterEach(() => {
  vi.clearAllMocks();
});

describe("hubGameDownloadRequest", () => {
  it("queues a rapid source unconditionally, with no archive lookup", async () => {
    const downloads: HubGameDownload[] = [
      { kind: "rapid", value: "ba:stable" },
    ];
    const request = await hubGameDownloadRequest(
      downloads,
      DEST,
      "Balanced Annihilation",
    );
    expect(request).toEqual({
      kind: "rapid",
      label: "Balanced Annihilation",
      args: { tag: "ba:stable" },
    });
    expect(dlGithubReleaseArchives).not.toHaveBeenCalled();
  });

  it("queues a url source with its saved-as filename", async () => {
    const downloads: HubGameDownload[] = [
      {
        kind: "url",
        value: "https://example.invalid/game.sdz",
        filename: "game.sdz",
      },
    ];
    const request = await hubGameDownloadRequest(downloads, DEST, "Some Game");
    expect(request).toEqual({
      kind: "file",
      label: "Some Game",
      args: {
        url: "https://example.invalid/game.sdz",
        destDir: DEST,
        filename: "game.sdz",
      },
    });
  });

  it("resolves a github source to its newest release archive when no asset is named", async () => {
    dlGithubReleaseArchives.mockResolvedValueOnce({
      archives: [
        {
          filename: "sf-0.2.sdz",
          url: "https://gh.example/0.2",
          size: 10,
          tag: "0.2",
        },
        {
          filename: "sf-0.1.sdz",
          url: "https://gh.example/0.1",
          size: 10,
          tag: "0.1",
        },
      ],
    });
    const downloads: HubGameDownload[] = [
      { kind: "github", value: "SplinterFaction/SplinterFaction" },
    ];
    const request = await hubGameDownloadRequest(
      downloads,
      DEST,
      "SplinterFaction",
    );
    expect(dlGithubReleaseArchives).toHaveBeenCalledWith({
      repo: "SplinterFaction/SplinterFaction",
    });
    expect(request).toEqual({
      kind: "file",
      label: "SplinterFaction",
      args: {
        url: "https://gh.example/0.2",
        destDir: DEST,
        filename: "sf-0.2.sdz",
      },
    });
  });

  it("picks the release archive matching the asset fragment", async () => {
    dlGithubReleaseArchives.mockResolvedValueOnce({
      archives: [
        {
          filename: "game-windows.zip",
          url: "https://gh.example/win",
          size: 10,
          tag: "1.0",
        },
        {
          filename: "game-linux.tar.gz",
          url: "https://gh.example/linux",
          size: 10,
          tag: "1.0",
        },
      ],
    });
    const downloads: HubGameDownload[] = [
      { kind: "github", value: "owner/repo", asset: "linux" },
    ];
    const request = await hubGameDownloadRequest(downloads, DEST, "Some Game");
    expect(request).toMatchObject({
      args: { url: "https://gh.example/linux", filename: "game-linux.tar.gz" },
    });
  });

  it("tries the next source when a github repo has no release archives", async () => {
    dlGithubReleaseArchives.mockResolvedValueOnce({ archives: [] });
    const downloads: HubGameDownload[] = [
      { kind: "github", value: "Balanced-Annihilation/Balanced-Annihilation" },
      { kind: "rapid", value: "ba:stable" },
    ];
    const request = await hubGameDownloadRequest(
      downloads,
      DEST,
      "Balanced Annihilation",
    );
    expect(request).toEqual({
      kind: "rapid",
      label: "Balanced Annihilation",
      args: { tag: "ba:stable" },
    });
  });

  it("tries the next source when no release matches the asset fragment", async () => {
    dlGithubReleaseArchives.mockResolvedValueOnce({
      archives: [
        {
          filename: "game-windows.zip",
          url: "https://gh.example/win",
          size: 10,
          tag: "1.0",
        },
      ],
    });
    const downloads: HubGameDownload[] = [
      { kind: "github", value: "owner/repo", asset: "linux" },
      {
        kind: "url",
        value: "https://mirror.example/game.sdz",
        filename: "game.sdz",
      },
    ];
    const request = await hubGameDownloadRequest(downloads, DEST, "Some Game");
    expect(request).toMatchObject({
      kind: "file",
      args: { filename: "game.sdz" },
    });
  });

  it("tries the next source when the github lookup itself throws", async () => {
    dlGithubReleaseArchives.mockRejectedValueOnce(new Error("network down"));
    const downloads: HubGameDownload[] = [
      { kind: "github", value: "owner/repo" },
      { kind: "rapid", value: "ba:stable" },
    ];
    const request = await hubGameDownloadRequest(downloads, DEST, "Some Game");
    expect(request).toMatchObject({
      kind: "rapid",
      args: { tag: "ba:stable" },
    });
  });

  it("respects the hub's order: an earlier usable source wins over a later one", async () => {
    const downloads: HubGameDownload[] = [
      { kind: "rapid", value: "ba:stable" },
      {
        kind: "url",
        value: "https://mirror.example/game.sdz",
        filename: "game.sdz",
      },
    ];
    const request = await hubGameDownloadRequest(downloads, DEST, "Some Game");
    expect(request).toMatchObject({ kind: "rapid" });
  });

  it("throws naming every source when all of them come up empty", async () => {
    dlGithubReleaseArchives.mockResolvedValueOnce({ archives: [] });
    const downloads: HubGameDownload[] = [
      { kind: "github", value: "owner/repo" },
    ];
    await expect(
      hubGameDownloadRequest(downloads, DEST, "Some Game"),
    ).rejects.toThrow(/Some Game/);
  });

  it("throws when the hub named no download source at all", async () => {
    await expect(hubGameDownloadRequest([], DEST, "Some Game")).rejects.toThrow(
      /Some Game/,
    );
  });
});
