import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchHubEngines,
  hasOfficialBuild,
  isEngineInstalled,
  offeredHubEngines,
  parseHubEngines,
} from "./hubEngines";

const row = (over: Record<string, unknown> = {}) => ({
  version: "2026.09.03",
  platform: "arm64-macos",
  filename: "recoil_2026.09.03_arm64-macos.7z",
  size: 1234,
  sha256: "a".repeat(64),
  note: "Built from main.",
  listed_at: "2026-11-25T10:00:00Z",
  page_url: "https://hub.example/engines/2026.09.03/arm64-macos",
  sources: ["https://m1.example/engines/recoil_2026.09.03_arm64-macos.7z"],
  ...over,
});

describe("parseHubEngines", () => {
  it("reads the hub's answer into rows", () => {
    const [engine] = parseHubEngines({ engines: [row()] });
    expect(engine).toEqual({
      version: "2026.09.03",
      platform: "arm64-macos",
      filename: "recoil_2026.09.03_arm64-macos.7z",
      size: 1234,
      sha256: "a".repeat(64),
      note: "Built from main.",
      listedAt: "2026-11-25T10:00:00Z",
      pageUrl: "https://hub.example/engines/2026.09.03/arm64-macos",
      sources: ["https://m1.example/engines/recoil_2026.09.03_arm64-macos.7z"],
    });
  });

  it("drops a row missing a field and keeps the rest", () => {
    const engines = parseHubEngines({
      engines: [row({ sha256: undefined }), row({ version: "2" }), null],
    });
    expect(engines.map((e) => e.version)).toEqual(["2"]);
  });

  it("refuses an answer with no list", () => {
    expect(() => parseHubEngines({})).toThrow();
    expect(() => parseHubEngines(null)).toThrow();
  });
});

describe("offeredHubEngines", () => {
  const engines = parseHubEngines({
    engines: [
      row(),
      row({ version: "2026.10.01" }),
      row({ version: "2026.10.02", sources: [] }),
      row({ version: "2026.10.03", platform: "amd64-linux" }),
    ],
  });

  it("hides builds an official release covers, held nowhere, or for another platform", () => {
    const official = [
      { version: "2026.10.01", platform: "arm64-macos" },
      { version: "2026.09.03", platform: "amd64-linux" },
    ];
    expect(
      offeredHubEngines(engines, official, "arm64-macos").map((e) => e.version),
    ).toEqual(["2026.09.03"]);
  });

  it("compares version and platform together", () => {
    const official = [{ version: "2026.09.03", platform: "amd64-linux" }];
    expect(hasOfficialBuild(official, "2026.09.03", "arm64-macos")).toBe(false);
    expect(hasOfficialBuild(official, "2026.09.03", "amd64-linux")).toBe(true);
  });
});

describe("fetchHubEngines", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for one platform", async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ engines: [row()] })),
    );
    vi.stubGlobal("fetch", fetch);
    const engines = await fetchHubEngines("https://hub.example", "arm64-macos");
    expect(engines).toHaveLength(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(
      "https://hub.example/api/v1/engines?platform=arm64-macos",
    );
  });

  it("names the status when the hub refuses", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    await expect(
      fetchHubEngines("https://hub.example", "arm64-macos"),
    ).rejects.toThrow("503");
  });

  it("names the hub when it cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network");
    });
    await expect(
      fetchHubEngines("https://hub.example", "arm64-macos"),
    ).rejects.toThrow("hub.example");
  });
});

describe("isEngineInstalled", () => {
  it("matches the folder name or the version the engine reported", () => {
    expect(isEngineInstalled([{ version: "2026.09.03" }], "2026.09.03")).toBe(
      true,
    );
    expect(
      isEngineInstalled(
        [{ version: "recoil-test", syncVersion: "2026.09.03 BAR" }],
        "2026.09.03",
      ),
    ).toBe(true);
    expect(isEngineInstalled([{ version: "2026.09.02" }], "2026.09.03")).toBe(
      false,
    );
  });
});
