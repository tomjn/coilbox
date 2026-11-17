import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchiveUploadState } from "../archiveUploads";

const notified = vi.fn();
vi.mock("@/notify/notify", () => ({
  notify: (input: unknown) => notified(input),
}));
const opened = vi.fn(async (_url: string) => {});
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => opened(url),
}));
const changed = vi.fn();
vi.mock("../manualSend/run", () => ({ noteHubChanged: () => changed() }));
vi.mock("../manualSend/status", () => ({
  gamePageUrl: (hub: string, shortname: string) => `${hub}/games/${shortname}`,
  mapPageUrl: (hub: string, slug: string) => `${hub}/map/${slug}`,
}));
const lookup = vi.fn();
vi.mock("../maps/lookup", () => ({
  fetchMapFacts: (...args: unknown[]) => lookup(...args),
}));

let heard: ((state: ArchiveUploadState) => void) | null = null;
let listed: ArchiveUploadState[] = [];
vi.mock("../archiveUploads", () => ({
  onArchiveUploadChanged: async (
    handler: (state: ArchiveUploadState) => void,
  ) => {
    heard = handler;
    return () => {};
  },
  listArchiveUploads: async () => listed,
}));

import {
  followArchiveUploads,
  forgetArchiveUploads,
  labelOf,
  linksFor,
  readArchiveUploads,
  rememberUpload,
  uploadOf,
} from "./store";

function state(patch: Partial<ArchiveUploadState> = {}): ArchiveUploadState {
  return {
    opId: "op-1",
    hubUrl: "https://hub.test",
    filename: "tabula_3.sd7",
    kind: "map",
    sha256: "a".repeat(64),
    phase: "sending",
    sent: 0,
    size: 100,
    uploadId: null,
    outcome: null,
    ...patch,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  forgetArchiveUploads();
  notified.mockClear();
  opened.mockClear();
  changed.mockClear();
  lookup.mockReset();
  lookup.mockResolvedValue({ ok: true, maps: [{ slug: "tabula-3" }] });
  heard = null;
  listed = [];
});

describe("following archive uploads", () => {
  it("hears the app's events and tells the player how an upload ended", async () => {
    await followArchiveUploads();
    rememberUpload(state(), {
      kind: "map",
      label: "Tabula 3",
      mapName: "Tabula 3",
    });
    heard?.(state({ phase: "done", outcome: { kind: "listed" } }));
    await flush();
    expect(notified).toHaveBeenCalledOnce();
    expect(notified.mock.calls[0][0]).toMatchObject({
      title: "Tabula 3 is on the hub",
      level: "success",
      sticky: false,
    });
    // The hub page of the map is found by asking the hub for its slug.
    notified.mock.calls[0][0].action.onClick();
    expect(opened).toHaveBeenCalledWith("https://hub.test/map/tabula-3");
    expect(changed).toHaveBeenCalledOnce();
  });

  it("says nothing when a quiet upload ends, but still asks pages to look again", async () => {
    await followArchiveUploads();
    rememberUpload(
      state(),
      { kind: "map", label: "Tabula 3" },
      { quiet: true },
    );
    heard?.(state({ phase: "done", outcome: { kind: "listed" } }));
    await flush();
    expect(notified).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledOnce();
  });

  it("says an ending once however many times it is heard", async () => {
    await followArchiveUploads();
    rememberUpload(state(), { kind: "map", label: "Tabula 3" });
    const done = state({ phase: "done", outcome: { kind: "listed" } });
    heard?.(done);
    heard?.(done);
    await flush();
    expect(notified).toHaveBeenCalledOnce();
  });

  it("keeps a refusal on screen until it is dismissed", async () => {
    await followArchiveUploads();
    rememberUpload(state(), { kind: "map", label: "Tabula 3" });
    heard?.(
      state({
        phase: "done",
        outcome: {
          kind: "stopped",
          source: "hub",
          code: "no_mirror",
          status: 503,
          said: "no mirror",
        },
      }),
    );
    await flush();
    expect(notified.mock.calls[0][0]).toMatchObject({
      level: "warning",
      sticky: true,
    });
  });

  it("does not repeat the ending of an upload that was over before it started following", async () => {
    listed = [state({ phase: "done", outcome: { kind: "listed" } })];
    await followArchiveUploads();
    await flush();
    expect(notified).not.toHaveBeenCalled();
  });

  it("drops a late arrival that is behind what it holds", async () => {
    await followArchiveUploads();
    rememberUpload(state({ phase: "waiting", sent: 100 }), {
      kind: "map",
      label: "Tabula 3",
    });
    rememberUpload(state({ phase: "reserving" }), {
      kind: "map",
      label: "Tabula 3",
    });
    const [one] = readArchiveUploads();
    expect(one.phase).toBe("waiting");
  });

  it("finds an upload by hub, kind and file name, and names it for a person", () => {
    rememberUpload(state(), { kind: "map", label: "Tabula 3" });
    const all = [state()];
    expect(
      uploadOf(all, "https://hub.test/", "map", "tabula_3.sd7")?.opId,
    ).toBe("op-1");
    expect(
      uploadOf(all, "https://other.test", "map", "tabula_3.sd7"),
    ).toBeUndefined();
    expect(
      uploadOf(all, "https://hub.test", "game", "tabula_3.sd7"),
    ).toBeUndefined();
    expect(uploadOf(all, "https://hub.test", "map", undefined)).toBeUndefined();
    expect(labelOf(state())).toBe("Tabula 3");
    expect(labelOf(state({ sha256: "b".repeat(64), filename: "x.sd7" }))).toBe(
      "x.sd7",
    );
  });
});

describe("the hub pages a message can point at", () => {
  it("points a listed game at its page without asking the hub", async () => {
    const subject = { kind: "game" as const, label: "SF", shortname: "sf" };
    const links = await linksFor(
      state({ kind: "game", outcome: { kind: "listed" } }),
      subject,
    );
    expect(links).toEqual({
      listed: "https://hub.test/games/sf",
      game: "https://hub.test/games/sf",
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("gives no link for a map the hub could not be asked about", async () => {
    lookup.mockRejectedValue(new Error("down"));
    const links = await linksFor(state({ outcome: { kind: "listed" } }), {
      kind: "map",
      label: "Tabula 3",
      mapName: "Tabula 3",
    });
    expect(links.listed).toBeNull();
  });

  it("names a game's page for a refusal, but does not claim it is listed", async () => {
    const links = await linksFor(
      state({
        kind: "game",
        outcome: {
          kind: "stopped",
          source: "hub",
          code: "not_owner",
          status: 403,
          said: "no",
        },
      }),
      { kind: "game", label: "SF", shortname: "sf" },
    );
    expect(links).toEqual({ listed: null, game: "https://hub.test/games/sf" });
  });
});
