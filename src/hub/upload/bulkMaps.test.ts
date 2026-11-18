import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { UploadFactsResult } from "@/content/bindings";
import type { NotifyInput } from "@/notify/notify";
import type { ArchiveFacts, ArchiveUploadOutcome } from "../archiveUploads";
import type { SweepReport } from "../maps/catalogSweep";
import type { MapFacts } from "../maps/lookup";
import {
  type BulkMapCandidate,
  type BulkTools,
  factsProblem,
  findMissingMaps,
  forgetBulkRun,
  readBulkRun,
  runBulkUpload,
  stopBulkUpload,
} from "./bulkMaps";

function facts(name: string, sha = name): ArchiveFacts {
  return {
    sha256: sha.padEnd(64, "0"),
    size: 100,
    filename: `${name.toLowerCase()}.sd7`,
    kind: "map",
    internal_name: name,
    version: "",
    shortname: null,
    author: null,
    description: null,
  };
}

function hubMap(hashes: string[]): MapFacts {
  return {
    downloads: hashes.map((sha256) => ({ sha256 })),
  } as unknown as MapFacts;
}

const TARGET = { hubUrl: "https://hub.test", enginePath: "/e", dataDir: "/d" };

/** A facts sweep of one map, which the hub took unless `patch` says otherwise. */
function report(patch: Partial<SweepReport> = {}): SweepReport {
  return {
    read: 1,
    asked: 1,
    wanted: 1,
    sent: 1,
    refused: 0,
    problems: [],
    skipped: [],
    errors: [],
    ...patch,
  };
}

function candidate(name: string): BulkMapCandidate {
  return { mapName: name, facts: facts(name), path: `/maps/${name}.sd7` };
}

/** Tools where every upload ends with the outcome `endings` gives its map. */
function tools(
  endings: Record<string, ArchiveUploadOutcome> = {},
  patch: Partial<Omit<BulkTools, "notify">> = {},
): BulkTools & { notify: Mock<(input: NotifyInput) => void> } {
  return {
    mapNames: async () => [],
    hubFacts: async () => ({ ok: true, maps: [] }),
    readFacts: async () => ({ errors: [] }),
    begin: vi.fn(async (subject) =>
      subject.kind === "map" ? `grant-${subject.map_name}` : "grant",
    ),
    end: vi.fn(async () => {}),
    sendFacts: vi.fn(async () => report()),
    start: vi.fn(
      async (_hub, _path, f: ArchiveFacts) =>
        ({ opId: `op-${f.internal_name}` }) as never,
    ),
    ended: async (opId) =>
      endings[opId.replace(/^op-/, "")] ?? { kind: "listed" },
    cancel: vi.fn(async () => {}),
    notify: vi.fn<(input: NotifyInput) => void>(),
    ...patch,
  };
}

beforeEach(() => {
  forgetBulkRun();
});

describe("finding the maps the hub has no file for", () => {
  it("reads only the maps the hub has no file for", async () => {
    const readFacts = vi.fn(
      async ({ map }: { map: string }): Promise<UploadFactsResult> => ({
        facts: facts(map),
        path: `/maps/${map}.sd7`,
        errors: [],
      }),
    );
    const found = await findMissingMaps(
      { hubUrl: "https://hub.test", enginePath: "/e", dataDir: "/d" },
      () => {},
      tools(
        {},
        {
          mapNames: async () => ["Has", "Unknown", "NoFile"],
          hubFacts: async () => ({
            ok: true,
            maps: [hubMap(["abc"]), null, hubMap([])],
          }),
          readFacts,
        },
      ),
    );
    expect(readFacts.mock.calls.map(([args]) => args.map)).toEqual([
      "Unknown",
      "NoFile",
    ]);
    expect(found.candidates.map((one) => one.path)).toEqual([
      "/maps/Unknown.sd7",
      "/maps/NoFile.sd7",
    ]);
    expect(found.listed).toBe(1);
  });

  it("keeps a map that cannot be uploaded apart, with the reason", async () => {
    const found = await findMissingMaps(
      { hubUrl: "https://hub.test", enginePath: "/e", dataDir: "/d" },
      () => {},
      tools(
        {},
        {
          mapNames: async () => ["Folder", "Broken"],
          hubFacts: async () => ({ ok: true, maps: [null, null] }),
          readFacts: async ({ map }) => {
            if (map === "Broken") throw new Error("worker died");
            return { problem: "It is an unpacked folder.", errors: [] };
          },
        },
      ),
    );
    expect(found.candidates).toEqual([]);
    expect(found.skipped).toEqual([
      { mapName: "Folder", reason: "It is an unpacked folder." },
      { mapName: "Broken", reason: "worker died" },
    ]);
  });

  it("offers one archive once when two map names come from it", async () => {
    const found = await findMissingMaps(
      { hubUrl: "https://hub.test", enginePath: "/e", dataDir: "/d" },
      () => {},
      tools(
        {},
        {
          mapNames: async () => ["A", "B"],
          hubFacts: async () => ({ ok: true, maps: [null, null] }),
          readFacts: async ({ map }) => ({
            facts: facts(map, "same"),
            path: "/maps/both.sd7",
            errors: [],
          }),
        },
      ),
    );
    expect(found.candidates.map((one) => one.mapName)).toEqual(["A"]);
  });

  it("stops when the hub cannot be asked, rather than call every map missing", async () => {
    const readFacts = vi.fn();
    await expect(
      findMissingMaps(
        { hubUrl: "https://hub.test", enginePath: "/e", dataDir: "/d" },
        () => {},
        tools(
          {},
          {
            mapNames: async () => ["A"],
            hubFacts: async () => ({ ok: false, reason: "The hub is down." }),
            readFacts,
          },
        ),
      ),
    ).rejects.toThrow("The hub is down.");
    expect(readFacts).not.toHaveBeenCalled();
  });
});

describe("uploading the maps found", () => {
  it("uploads them in order, each under its own grant", async () => {
    const t = tools();
    await runBulkUpload(TARGET, [candidate("A"), candidate("B")], t);
    expect(t.start).toHaveBeenNthCalledWith(
      1,
      "https://hub.test",
      "/maps/A.sd7",
      facts("A"),
      "grant-A",
    );
    expect(t.start).toHaveBeenNthCalledWith(
      2,
      "https://hub.test",
      "/maps/B.sd7",
      facts("B"),
      "grant-B",
    );
    expect(t.end).toHaveBeenCalledWith("grant-A");
    expect(t.end).toHaveBeenCalledWith("grant-B");
    expect(readBulkRun()).toMatchObject({
      running: false,
      items: [{ status: "listed" }, { status: "listed" }],
    });
    expect(t.notify).toHaveBeenCalledOnce();
    expect(t.notify.mock.calls[0][0]).toMatchObject({ level: "success" });
  });

  it("sends each map's facts under its grant before its file", async () => {
    const order: string[] = [];
    const t = tools(
      {},
      {
        sendFacts: vi.fn(async (_target, mapName: string, grant: string) => {
          order.push(`facts ${mapName} ${grant}`);
          return report();
        }),
        start: vi.fn(async (_hub, _path, f: ArchiveFacts, grant: string) => {
          order.push(`file ${f.internal_name} ${grant}`);
          return { opId: `op-${f.internal_name}` } as never;
        }),
      },
    );
    await runBulkUpload(TARGET, [candidate("A"), candidate("B")], t);
    expect(t.sendFacts).toHaveBeenCalledWith(TARGET, "A", "grant-A");
    expect(order).toEqual([
      "facts A grant-A",
      "file A grant-A",
      "facts B grant-B",
      "file B grant-B",
    ]);
  });

  it("does not upload a file whose facts the hub would not take", async () => {
    const start = vi.fn(
      async (_hub: string, _path: string, f: ArchiveFacts) =>
        ({ opId: `op-${f.internal_name}` }) as never,
    );
    const t = tools(
      {},
      {
        start,
        sendFacts: vi.fn(async (_target, mapName: string) =>
          mapName === "A"
            ? report({
                sent: 0,
                refused: 1,
                problems: [{ map_name: "A", outcome: "refused", said: "No." }],
              })
            : report(),
        ),
      },
    );
    await runBulkUpload(TARGET, [candidate("A"), candidate("B")], t);
    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0][2]).toEqual(facts("B"));
    expect(readBulkRun()?.items).toMatchObject([
      { status: "failed", said: "No." },
      { status: "listed" },
    ]);
    expect(t.end).toHaveBeenCalledWith("grant-A");
  });

  it("carries on past a map that fails, and says why it failed", async () => {
    const t = tools(
      {
        A: {
          kind: "stopped",
          source: "hub",
          code: "no_mirror",
          status: 503,
          said: "no mirror",
        },
      },
      {
        start: vi.fn(async (_hub, _path, f: ArchiveFacts) => {
          if (f.internal_name === "B") throw new Error("file changed");
          return { opId: `op-${f.internal_name}` } as never;
        }),
      },
    );
    await runBulkUpload(
      TARGET,
      [candidate("A"), candidate("B"), candidate("C")],
      t,
    );
    const items = readBulkRun()?.items ?? [];
    expect(items.map((item) => item.status)).toEqual([
      "failed",
      "failed",
      "listed",
    ]);
    expect(items[0].said).toBeTruthy();
    expect(items[1].said).toBe("file changed");
    // The grant opened for the map that failed to start is still closed.
    expect(t.end).toHaveBeenCalledWith("grant-B");
    expect(t.notify.mock.calls[0][0]).toMatchObject({
      level: "warning",
      sticky: true,
    });
  });

  it("cancels the upload going when stopped, and sends no more", async () => {
    let finish: (outcome: ArchiveUploadOutcome) => void = () => {};
    const t = tools(
      {},
      {
        ended: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    );
    const done = runBulkUpload(TARGET, [candidate("A"), candidate("B")], t);
    await vi.waitFor(() => expect(t.start).toHaveBeenCalledOnce());
    await Promise.resolve();
    stopBulkUpload(t);
    expect(t.cancel).toHaveBeenCalledWith("op-A");
    finish({ kind: "cancelled" });
    await done;
    expect(t.start).toHaveBeenCalledOnce();
    expect(readBulkRun()?.items.map((item) => item.status)).toEqual([
      "stopped",
      "stopped",
    ]);
  });
});

describe("whether a map's facts let its file go up", () => {
  it("lets it go when the hub took the facts or already had them", () => {
    expect(factsProblem(report())).toBeNull();
    expect(factsProblem(report({ wanted: 0, sent: 0 }))).toBeNull();
  });

  it("stops it when the map could not be read", () => {
    expect(factsProblem(report({ read: 0, errors: ["bad archive"] }))).toBe(
      "bad archive",
    );
    expect(factsProblem(report({ read: 0 }))).toBeTruthy();
  });

  it("stops it when the hub refused the facts, with the hub's words", () => {
    expect(
      factsProblem(
        report({
          refused: 1,
          problems: [{ map_name: "A", outcome: "refused", said: "No." }],
        }),
      ),
    ).toBe("No.");
    expect(
      factsProblem(
        report({
          refused: 1,
          problems: [{ map_name: "A", outcome: "conflict" }],
        }),
      ),
    ).toBeTruthy();
  });
});
