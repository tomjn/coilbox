import { describe, expect, it } from "vitest";
import type { HubGameDownload } from "../api";
import { hubGameDownloadRequest } from "./download";

const DEST = "/content/games";

describe("hubGameDownloadRequest", () => {
  it("queues every source in the hub's order, hash included, for the queue to try", async () => {
    const downloads: HubGameDownload[] = [
      { kind: "rapid", value: "ba:stable" },
      { kind: "github", value: "owner/repo", asset: "linux" },
      {
        kind: "url",
        value: "https://mirror.example/game.sdz",
        filename: "game.sdz",
        sha256: "a".repeat(64),
      },
    ];
    const request = await hubGameDownloadRequest(downloads, DEST, "Some Game");
    expect(request).toEqual({
      kind: "hubGame",
      label: "Some Game",
      args: { downloads, destDir: DEST },
    });
  });

  it("throws when the hub named no download source at all", async () => {
    await expect(hubGameDownloadRequest([], DEST, "Some Game")).rejects.toThrow(
      /Some Game/,
    );
  });
});
