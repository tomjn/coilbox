import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { unitsyncUploadFacts, loadContentState, notify } = vi.hoisted(() => ({
  unitsyncUploadFacts: vi.fn(),
  loadContentState: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("../content/bindings", () => ({ unitsyncUploadFacts }));
vi.mock("../content/contentState", () => ({ loadContentState }));
vi.mock("../content/config", () => ({
  targetsFromState: () => [{ enginePath: "/engines/e1", rootPath: "/data" }],
  preferredTarget: (targets: unknown[]) => targets[0] ?? null,
}));
vi.mock("../notify/notify", () => ({ notify }));

import type { ArchiveFacts } from "../hub/archiveUploads";
import {
  installSettingsStorage,
  memorySettingsStorage,
} from "../lib/storedSetting";
import { setHubMapBase } from "./hubMapBase";
import {
  checkHubDownload,
  differingFacts,
  forgetCatalogues,
  type ListedArchive,
  listedArchive,
  RETRY_AFTER_MS,
  readCatalogue,
  rootOf,
  sendMismatchReport,
  wasReported,
} from "./hubMismatch";

const HUB = "https://hub.example";
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

const listedMap: ListedArchive = {
  sha256: HASH,
  kind: "map",
  shortname: null,
  internal_name: "Isis 1.3",
  version: "1.3",
};
const listedGame: ListedArchive = {
  sha256: HASH,
  kind: "game",
  shortname: "sf",
  internal_name: "Splinter Faction 1.2",
  version: "1.2",
};

const readFrom = (
  listed: ListedArchive,
  over: Partial<ArchiveFacts> = {},
): ArchiveFacts => ({
  sha256: listed.sha256,
  size: 10,
  filename: "x.sd7",
  kind: listed.kind,
  internal_name: listed.internal_name,
  version: listed.version,
  shortname: listed.shortname,
  author: null,
  description: null,
  ...over,
});

interface Reply {
  status: number;
  body?: unknown;
}

/** A hub that holds `archives` and answers each report with the next of `reports`. */
function fakeHub(archives: ListedArchive[], reports: Reply[] = []) {
  const requests: { url: string; method: string; body?: unknown }[] = [];
  let report = 0;
  const handler = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    requests.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.endsWith("/api/v1/catalogue")) {
      return new Response(JSON.stringify({ v: 1, archives }), { status: 200 });
    }
    const reply = reports[Math.min(report++, reports.length - 1)] ?? {
      status: 202,
      body: { outcome: "recorded" },
    };
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status,
    });
  });
  vi.stubGlobal("fetch", handler);
  return {
    requests,
    reports: () => requests.filter((r) => r.method === "POST"),
    catalogueFetches: () => requests.filter((r) => r.method === "GET").length,
  };
}

const RECORDED: Reply = { status: 202, body: { outcome: "recorded" } };

const mapFile = {
  sha256: HASH,
  destDir: "/data/maps",
  filename: "isis_1.3.sd7",
};
const gameFile = {
  sha256: HASH,
  destDir: "/data/games",
  filename: "sf.sdz",
};

beforeEach(() => {
  vi.clearAllMocks();
  forgetCatalogues();
  installSettingsStorage(memorySettingsStorage());
  setHubMapBase(HUB);
  loadContentState.mockResolvedValue({ roots: [] });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  installSettingsStorage(null);
});

describe("differingFacts", () => {
  it("is null when every field agrees", () => {
    expect(differingFacts(listedMap, readFrom(listedMap))).toBeNull();
    expect(differingFacts(listedGame, readFrom(listedGame))).toBeNull();
  });

  it("sends the kind when it differs", () => {
    expect(
      differingFacts(listedMap, readFrom(listedMap, { kind: "game" })),
    ).toEqual({ kind: "game" });
  });

  it("sends the shortname when it differs, including to or from none", () => {
    expect(
      differingFacts(listedGame, readFrom(listedGame, { shortname: "other" })),
    ).toEqual({ shortname: "other" });
    expect(
      differingFacts(listedGame, readFrom(listedGame, { shortname: null })),
    ).toEqual({ shortname: null });
    expect(
      differingFacts(listedMap, readFrom(listedMap, { shortname: "sf" })),
    ).toEqual({ shortname: "sf" });
  });

  it("sends the name when it differs", () => {
    expect(
      differingFacts(
        listedMap,
        readFrom(listedMap, { internal_name: "Another Map" }),
      ),
    ).toEqual({ internal_name: "Another Map" });
  });

  it("sends the version when it differs", () => {
    expect(
      differingFacts(listedMap, readFrom(listedMap, { version: "9" })),
    ).toEqual({ version: "9" });
  });

  it("sends every field that differs and no other", () => {
    expect(
      differingFacts(
        listedGame,
        readFrom(listedGame, { internal_name: "x", version: "y" }),
      ),
    ).toEqual({ internal_name: "x", version: "y" });
  });

  it("does not compare the author, the description or the size", () => {
    expect(
      differingFacts(
        listedMap,
        readFrom(listedMap, { author: "someone", description: "d", size: 1 }),
      ),
    ).toBeNull();
  });
});

describe("readCatalogue", () => {
  it("keeps whole archives by hash and drops the rest", () => {
    const byHash = readCatalogue({
      archives: [
        { ...listedMap, filename: "x.sd7", size: 1 },
        { ...listedGame, sha256: OTHER_HASH, kind: "tweak" },
        { ...listedGame, sha256: OTHER_HASH, version: 3 },
        null,
      ],
    });
    expect([...byHash.keys()]).toEqual([HASH]);
    expect(byHash.get(HASH)).toEqual(listedMap);
  });

  it("refuses a body with no archives list", () => {
    expect(() => readCatalogue({})).toThrow();
  });
});

describe("rootOf", () => {
  it("is the folder a maps or games folder is in", () => {
    expect(rootOf("/data/maps")).toBe("/data");
    expect(rootOf("/data/games/")).toBe("/data");
    expect(rootOf("C:\\spring\\maps")).toBe("C:\\spring");
  });
});

describe("listedArchive", () => {
  it("holds the catalogue, so a second hash it holds asks nobody", async () => {
    const hub = fakeHub([listedMap, { ...listedGame, sha256: OTHER_HASH }]);

    await listedArchive(HUB, HASH, 0);
    await listedArchive(HUB, OTHER_HASH, 0);

    expect(hub.catalogueFetches()).toBe(1);
  });

  it("fetches again for a hash it lacks when the held copy is older than the check", async () => {
    const hub = fakeHub([listedMap]);
    await listedArchive(HUB, HASH, 0);

    const listed = await listedArchive(
      HUB,
      OTHER_HASH,
      Number.MAX_SAFE_INTEGER,
    );

    expect(listed).toBeUndefined();
    expect(hub.catalogueFetches()).toBe(2);
  });

  it("does not fetch again for a hash it lacks when the copy loaded after the check began", async () => {
    const hub = fakeHub([listedMap]);
    await listedArchive(HUB, HASH, 0);

    await listedArchive(HUB, OTHER_HASH, 0);

    expect(hub.catalogueFetches()).toBe(1);
  });
});

describe("sendMismatchReport, against a fake hub", () => {
  const send = async (reply: Reply) => {
    const hub = fakeHub([], [reply]);
    const outcome = await sendMismatchReport(HUB, HASH, {
      internal_name: "Another Map",
    });
    return { outcome, hub };
  };

  it("posts the hash and what differs to the configured hub, with no sign-in", async () => {
    const { hub } = await send(RECORDED);

    expect(hub.requests).toEqual([
      {
        url: `${HUB}/api/v1/archives/mismatch`,
        method: "POST",
        body: { sha256: HASH, found: { internal_name: "Another Map" } },
      },
    ]);
    const init = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.headers).toEqual({ "content-type": "application/json" });
  });

  it("goes to the hub it was given and keeps a path prefix, never the old Vercel address", async () => {
    const hub = fakeHub([], [RECORDED]);

    await sendMismatchReport("https://example.test/hub/", HASH, {
      version: "2",
    });

    expect(hub.requests[0].url).toBe(
      "https://example.test/hub/api/v1/archives/mismatch",
    );
    expect(hub.requests[0].url).not.toMatch(/vercel/);
  });

  it("202 is recorded", async () => {
    expect((await send(RECORDED)).outcome).toEqual({ kind: "recorded" });
  });

  it("200 is already reported", async () => {
    const { outcome } = await send({
      status: 200,
      body: { outcome: "already" },
    });
    expect(outcome).toEqual({ kind: "already" });
  });

  it("400 is refused, with the hub's reason", async () => {
    const { outcome } = await send({
      status: 400,
      body: {
        error: "found must name at least one field.",
        reason: "bad_request",
      },
    });
    expect(outcome).toEqual({
      kind: "refused",
      status: 400,
      reason: "bad_request",
    });
  });

  it("404 is refused as an archive the hub does not list", async () => {
    const { outcome } = await send({
      status: 404,
      body: { reason: "unknown_archive" },
    });
    expect(outcome).toEqual({
      kind: "refused",
      status: 404,
      reason: "unknown_archive",
    });
  });

  it("422 is refused as agreeing, which is a comparison bug here", async () => {
    const { outcome } = await send({ status: 422, body: { reason: "agrees" } });
    expect(outcome).toEqual({ kind: "refused", status: 422, reason: "agrees" });
  });

  it("429 is rate limited", async () => {
    const { outcome } = await send({
      status: 429,
      body: { reason: "rate_limited" },
    });
    expect(outcome).toEqual({ kind: "rate_limited" });
  });

  it("503 is unavailable", async () => {
    const { outcome } = await send({
      status: 503,
      body: { reason: "unavailable" },
    });
    expect(outcome).toEqual({ kind: "unavailable" });
  });

  it("an answer that is not JSON is still a refusal with its status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { status: 413 })),
    );

    expect(await sendMismatchReport(HUB, HASH, { version: "2" })).toEqual({
      kind: "refused",
      status: 413,
      reason: "",
    });
  });

  it("no answer at all is not sent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );

    expect(await sendMismatchReport(HUB, HASH, { version: "2" })).toEqual({
      kind: "not_sent",
      why: "network down",
    });
  });

  it("does not send a report over the size the hub takes", async () => {
    const hub = fakeHub([], [RECORDED]);
    // Control characters are escaped to six bytes each in JSON.
    const dense = "\u0001".repeat(256);

    const outcome = await sendMismatchReport(HUB, HASH, {
      internal_name: dense,
      version: dense,
      shortname: dense,
    });

    expect(outcome.kind).toBe("not_sent");
    expect(hub.requests).toEqual([]);
  });
});

describe("checkHubDownload", () => {
  it("sends nothing when the archive says what the hub lists", async () => {
    const hub = fakeHub([listedMap]);
    unitsyncUploadFacts.mockResolvedValue({
      facts: readFrom(listedMap),
      errors: [],
    });

    await checkHubDownload(mapFile);

    expect(hub.reports()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expect(wasReported(HASH)).toBe(false);
  });

  it("reports what differs, tells the player, and remembers the hash", async () => {
    const hub = fakeHub([listedMap], [RECORDED]);
    unitsyncUploadFacts.mockResolvedValue({
      facts: readFrom(listedMap, { internal_name: "Another Map" }),
      errors: [],
    });

    await checkHubDownload(mapFile);

    expect(hub.reports()).toEqual([
      {
        url: `${HUB}/api/v1/archives/mismatch`,
        method: "POST",
        body: { sha256: HASH, found: { internal_name: "Another Map" } },
      },
    ]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].body).toMatch(
      /isis_1\.3\.sd7 is not what the hub says it is\. The hub has been told/,
    );
    expect(wasReported(HASH)).toBe(true);
  });

  it("does not report the same download twice", async () => {
    const hub = fakeHub([listedMap], [RECORDED]);
    unitsyncUploadFacts.mockResolvedValue({
      facts: readFrom(listedMap, { version: "9" }),
      errors: [],
    });

    await checkHubDownload(mapFile);
    await checkHubDownload(mapFile);

    expect(hub.reports()).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("reads a map by its archive file, since its name is what is in doubt", async () => {
    fakeHub([listedMap], [RECORDED]);
    unitsyncUploadFacts.mockResolvedValue({
      facts: readFrom(listedMap, { version: "9" }),
      errors: [],
    });

    await checkHubDownload(mapFile);

    expect(unitsyncUploadFacts).toHaveBeenCalledWith({
      enginePath: "/engines/e1",
      dataDir: "/data",
      mapArchive: "isis_1.3.sd7",
    });
  });

  it("reads a game by its archive name, and reports a changed shortname and kind", async () => {
    const hub = fakeHub([listedGame], [RECORDED]);
    unitsyncUploadFacts.mockResolvedValue({
      facts: readFrom(listedGame, { shortname: "other", kind: "map" }),
      errors: [],
    });

    await checkHubDownload(gameFile);

    expect(unitsyncUploadFacts).toHaveBeenCalledWith({
      enginePath: "/engines/e1",
      dataDir: "/data",
      game: "sf.sdz",
    });
    expect(hub.reports()[0].body).toEqual({
      sha256: HASH,
      found: { kind: "map", shortname: "other" },
    });
  });

  it("sends every request to the configured hub", async () => {
    setHubMapBase("http://127.0.0.1:8201");
    const hub = fakeHub([listedMap], [RECORDED]);
    unitsyncUploadFacts.mockResolvedValue({
      facts: readFrom(listedMap, { version: "9" }),
      errors: [],
    });

    await checkHubDownload(mapFile);

    expect(hub.requests.map((r) => r.url)).toEqual([
      "http://127.0.0.1:8201/api/v1/catalogue",
      "http://127.0.0.1:8201/api/v1/archives/mismatch",
    ]);
  });

  it("does nothing when the hub is off", async () => {
    setHubMapBase(null);
    const hub = fakeHub([listedMap]);

    await checkHubDownload(mapFile);

    expect(hub.requests).toEqual([]);
    expect(unitsyncUploadFacts).not.toHaveBeenCalled();
  });

  it("does nothing when the hub lists no archive with that hash", async () => {
    const hub = fakeHub([{ ...listedMap, sha256: OTHER_HASH }]);

    await checkHubDownload(mapFile);

    expect(hub.reports()).toEqual([]);
    expect(unitsyncUploadFacts).not.toHaveBeenCalled();
  });

  it("does nothing when the catalogue cannot be fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );

    await expect(checkHubDownload(mapFile)).resolves.toBeUndefined();

    expect(unitsyncUploadFacts).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("does nothing when the archive cannot be read", async () => {
    const hub = fakeHub([listedMap]);
    unitsyncUploadFacts.mockResolvedValue({
      problem: "No map archive named isis_1.3.sd7 is installed.",
      errors: [],
    });

    await checkHubDownload(mapFile);

    expect(hub.reports()).toEqual([]);
  });

  it("does nothing when unitsync read a different file than the one downloaded", async () => {
    const hub = fakeHub([listedMap]);
    unitsyncUploadFacts.mockResolvedValue({
      facts: readFrom(listedMap, { sha256: OTHER_HASH, version: "9" }),
      errors: [],
    });

    await checkHubDownload(mapFile);

    expect(hub.reports()).toEqual([]);
  });

  it("does nothing when the content folders cannot be read", async () => {
    const hub = fakeHub([listedMap]);
    loadContentState.mockRejectedValue(new Error("no state"));

    await checkHubDownload(mapFile);

    expect(hub.reports()).toEqual([]);
    expect(unitsyncUploadFacts).not.toHaveBeenCalled();
  });

  describe("what the hub answers", () => {
    const differs = () =>
      unitsyncUploadFacts.mockResolvedValue({
        facts: readFrom(listedMap, { version: "9" }),
        errors: [],
      });

    it("200 already: counts as told and is remembered", async () => {
      const hub = fakeHub(
        [listedMap],
        [{ status: 200, body: { outcome: "already" } }],
      );
      differs();

      await checkHubDownload(mapFile);

      expect(hub.reports()).toHaveLength(1);
      expect(notify.mock.calls[0][0].body).toMatch(/The hub has been told/);
      expect(wasReported(HASH)).toBe(true);
    });

    it("400: logged, not shown to the player, remembered so it is not sent again", async () => {
      fakeHub([listedMap], [{ status: 400, body: { reason: "bad_request" } }]);
      differs();

      await checkHubDownload(mapFile);

      expect(console.error).toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
      expect(wasReported(HASH)).toBe(true);
    });

    it("404: logged, not shown to the player, not remembered", async () => {
      fakeHub(
        [listedMap],
        [{ status: 404, body: { reason: "unknown_archive" } }],
      );
      differs();

      await checkHubDownload(mapFile);

      expect(console.error).toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
      expect(wasReported(HASH)).toBe(false);
    });

    it("422 agrees: logged as the bug it is, not shown to the player, remembered", async () => {
      const hub = fakeHub(
        [listedMap],
        [{ status: 422, body: { reason: "agrees" } }],
      );
      differs();

      await checkHubDownload(mapFile);

      expect(hub.reports()).toHaveLength(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("422 agrees"),
        { version: "9" },
      );
      expect(notify).not.toHaveBeenCalled();
      expect(wasReported(HASH)).toBe(true);
    });

    it("429: the player is told the hub could not be, it is not retried and not remembered", async () => {
      const hub = fakeHub(
        [listedMap],
        [{ status: 429, body: { reason: "rate_limited" } }],
      );
      differs();

      await checkHubDownload(mapFile);

      expect(hub.reports()).toHaveLength(1);
      expect(notify.mock.calls[0][0].body).toMatch(/could not tell the hub/);
      expect(wasReported(HASH)).toBe(false);
    });

    it("503 then 202: retries once, later, and the second answer counts", async () => {
      vi.useFakeTimers();
      const hub = fakeHub(
        [listedMap],
        [{ status: 503, body: { reason: "unavailable" } }, RECORDED],
      );
      differs();

      const done = checkHubDownload(mapFile);
      await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS - 1);
      expect(hub.reports()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      await done;

      expect(hub.reports()).toHaveLength(2);
      expect(notify.mock.calls[0][0].body).toMatch(/The hub has been told/);
      expect(wasReported(HASH)).toBe(true);
    });

    it("503 twice: stops after one retry, tells the player, does not remember", async () => {
      vi.useFakeTimers();
      const hub = fakeHub(
        [listedMap],
        [{ status: 503, body: { reason: "unavailable" } }],
      );
      differs();

      const done = checkHubDownload(mapFile);
      await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS * 10);
      await done;

      expect(hub.reports()).toHaveLength(2);
      expect(notify.mock.calls[0][0].body).toMatch(/could not tell the hub/);
      expect(wasReported(HASH)).toBe(false);
    });

    it("no answer: not retried, the player is told the hub could not be", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url.endsWith("/catalogue")) {
            return new Response(JSON.stringify({ archives: [listedMap] }));
          }
          throw new TypeError("network down");
        }),
      );
      differs();

      await checkHubDownload(mapFile);

      expect(notify.mock.calls[0][0].body).toMatch(/could not tell the hub/);
      expect(wasReported(HASH)).toBe(false);
    });
  });
});
