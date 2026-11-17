import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dlDownloadRaw, dlDownloadFileRaw, dlGithubReleaseArchives, notify } =
  vi.hoisted(() => ({
    dlDownloadRaw: vi.fn(),
    dlDownloadFileRaw: vi.fn(),
    dlGithubReleaseArchives: vi.fn(),
    notify: vi.fn(),
  }));

vi.mock("./bindings", () => ({
  dlDownloadRaw,
  dlDownloadFileRaw,
  dlGithubReleaseArchives,
}));
vi.mock("../notify/notify", () => ({ notify }));
// There is no webview here to register a real `Channel` against.
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (sample: unknown) => void = () => {};
  },
}));

import type { HubGameDownload } from "../hub/api";
import type { DownloadAttempt } from "./downloadHistory";
import { downloadHubGame } from "./downloadHubGame";
import { invalidateGithubReleases } from "./githubReleases";
import { SourceWalkError } from "./sourceWalk";

const DEST = "/data/games";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const mirror = (host: string, sha256?: string): HubGameDownload => ({
  kind: "url",
  value: `https://${host}/maps/game.sdz`,
  filename: "game.sdz",
  sha256,
});

const run = (downloads: HubGameDownload[], attempts: DownloadAttempt[] = []) =>
  downloadHubGame({
    label: "Some Game",
    downloads,
    destDir: DEST,
    onProgress: () => {},
    onAttempt: (a) => attempts.push(a),
  });

const mismatch = (host: string) =>
  new Error(
    `Checksum mismatch for game.sdz: expected ${HASH_A}, got ${HASH_B} (${host})`,
  );

beforeEach(() => {
  invalidateGithubReleases();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downloadHubGame", () => {
  it("passes a mirror's hash to the file download, and installs when it matches", async () => {
    dlDownloadFileRaw.mockResolvedValueOnce({ path: "/data/games/game.sdz" });
    const attempts: DownloadAttempt[] = [];

    await run([mirror("a.example", HASH_A)], attempts);

    expect(dlDownloadFileRaw).toHaveBeenCalledTimes(1);
    expect(dlDownloadFileRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://a.example/maps/game.sdz",
        destDir: DEST,
        filename: "game.sdz",
        sha256: HASH_A,
      }),
    );
    expect(attempts.map((a) => a.outcome)).toEqual(["ok"]);
  });

  it("downloads as before when the source lists no hash", async () => {
    dlDownloadFileRaw.mockResolvedValueOnce({ path: "/data/games/game.sdz" });

    await run([mirror("a.example")]);

    expect(dlDownloadFileRaw.mock.calls[0][0].sha256).toBeUndefined();
  });

  it("moves to the next source when a file does not match its hash", async () => {
    dlDownloadFileRaw
      .mockRejectedValueOnce(mismatch("a.example"))
      .mockResolvedValueOnce({ path: "/data/games/game.sdz" });
    const attempts: DownloadAttempt[] = [];

    await run(
      [mirror("a.example", HASH_A), mirror("b.example", HASH_A)],
      attempts,
    );

    expect(dlDownloadFileRaw.mock.calls.map((c) => c[0].url)).toEqual([
      "https://a.example/maps/game.sdz",
      "https://b.example/maps/game.sdz",
    ]);
    expect(attempts.map((a) => [a.mirror, a.outcome])).toEqual([
      ["a.example", "failed"],
      ["b.example", "ok"],
    ]);
    expect(attempts[0].failure).toMatch(/did not match its checksum/);
  });

  it("moves on from a failed transfer to a rapid source below it", async () => {
    dlDownloadFileRaw.mockRejectedValueOnce(new Error("connection reset"));
    dlDownloadRaw.mockResolvedValueOnce({});

    await run([mirror("a.example"), { kind: "rapid", value: "ba:stable" }]);

    expect(dlDownloadRaw).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "ba:stable" }),
    );
  });

  it("stops at the first source that delivers", async () => {
    dlDownloadRaw.mockResolvedValueOnce({});

    await run([{ kind: "rapid", value: "ba:stable" }, mirror("a.example")]);

    expect(dlDownloadFileRaw).not.toHaveBeenCalled();
  });

  it("skips a url source that names no filename", async () => {
    dlDownloadRaw.mockResolvedValueOnce({});

    await run([
      { kind: "url", value: "https://a.example/game" },
      { kind: "rapid", value: "ba:stable" },
    ]);

    expect(dlDownloadFileRaw).not.toHaveBeenCalled();
    expect(dlDownloadRaw).toHaveBeenCalled();
  });

  it("falls through a github repo with no release archives", async () => {
    dlGithubReleaseArchives.mockResolvedValueOnce({ archives: [] });
    dlDownloadRaw.mockResolvedValueOnce({});

    await run([
      { kind: "github", value: "owner/repo" },
      { kind: "rapid", value: "ba:stable" },
    ]);

    expect(dlDownloadFileRaw).not.toHaveBeenCalled();
    expect(dlDownloadRaw).toHaveBeenCalled();
  });

  it("fetches the github archive matching the asset fragment", async () => {
    dlGithubReleaseArchives.mockResolvedValueOnce({
      archives: [
        {
          filename: "g-win.zip",
          url: "https://gh.example/w",
          size: 1,
          tag: "1",
        },
        {
          filename: "g-linux.zip",
          url: "https://gh.example/l",
          size: 1,
          tag: "1",
        },
      ],
    });
    dlDownloadFileRaw.mockResolvedValueOnce({});

    await run([{ kind: "github", value: "owner/repo", asset: "LINUX" }]);

    expect(dlDownloadFileRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gh.example/l",
        filename: "g-linux.zip",
      }),
    );
  });

  it("fails naming every source's reason, the last one included, when all fail", async () => {
    dlDownloadFileRaw
      .mockRejectedValueOnce(mismatch("a.example"))
      .mockRejectedValueOnce(
        new Error("HTTP status client error (404 Not Found)"),
      );

    const error = await run([
      mirror("a.example", HASH_A),
      mirror("b.example", HASH_A),
    ]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SourceWalkError);
    const text = (error as Error).message;
    expect(text).toMatch(/Some Game/);
    expect(text).toMatch(/a\.example: .*did not match its checksum/);
    expect(text).toMatch(/b\.example answered 404/);
    expect(text.indexOf("a.example")).toBeLessThan(text.indexOf("b.example"));
  });

  it("stops the walk when the player cancels", async () => {
    dlDownloadFileRaw.mockRejectedValueOnce(new Error("Download cancelled."));

    const error = await run([
      mirror("a.example", HASH_A),
      mirror("b.example", HASH_A),
    ]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SourceWalkError);
    expect(dlDownloadFileRaw).toHaveBeenCalledTimes(1);
  });
});
