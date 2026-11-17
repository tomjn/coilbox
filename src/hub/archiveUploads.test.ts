/**
 * Issue #5258: the binding to the archive upload commands. What decides
 * anything is in Rust, so this holds the names and shapes that cross the
 * boundary: the three command names, the camel case argument names, the
 * optional grant that is left off rather than sent empty, and the event a page
 * listens on.
 */
import { describe, expect, it, vi } from "vitest";

const sent: { command: string; args: unknown }[] = [];
const answers: Record<string, unknown> = {};
let handler: ((event: { payload: unknown }) => void) | null = null;
let listenedTo = "";

vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand:
    (_plugin: string, command: string) =>
    async (args: unknown): Promise<unknown> => {
      sent.push({ command, args });
      return answers[command];
    },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, callback: typeof handler) => {
    listenedTo = name;
    handler = callback;
    return () => {};
  },
}));

const {
  ARCHIVE_UPLOAD_EVENT,
  cancelArchiveUpload,
  listArchiveUploads,
  onArchiveUploadChanged,
  startArchiveUpload,
} = await import("./archiveUploads");

const facts = {
  sha256: "a".repeat(64),
  size: 10,
  filename: "persepolis.sd7",
  kind: "map" as const,
  internal_name: "Persepolis 1",
  version: "1",
  shortname: null,
  author: null,
  description: null,
};

const state = {
  opId: "op",
  hubUrl: "https://hub.example",
  filename: "persepolis.sd7",
  kind: "map" as const,
  sha256: "a".repeat(64),
  phase: "reserving" as const,
  sent: 0,
  size: 10,
  uploadId: null,
  outcome: null,
};

describe("archive uploads", () => {
  it("starts an upload with the facts as they are and no empty grant", async () => {
    answers.hub_archive_upload_start = { upload: state };

    const started = await startArchiveUpload(
      "https://hub.example",
      "/maps/persepolis.sd7",
      facts,
    );

    expect(started).toEqual(state);
    expect(sent.at(-1)).toEqual({
      command: "hub_archive_upload_start",
      args: {
        hubUrl: "https://hub.example",
        path: "/maps/persepolis.sd7",
        facts,
      },
    });
  });

  it("passes the grant of a manual send along", async () => {
    answers.hub_archive_upload_start = { upload: state };

    await startArchiveUpload("https://hub.example", "/p", facts, "grant-1");

    expect(sent.at(-1)?.args).toMatchObject({ grant: "grant-1" });
  });

  it("lists the uploads and cancels one by its op id", async () => {
    answers.hub_archive_upload_list = { uploads: [state] };

    expect(await listArchiveUploads()).toEqual([state]);
    await cancelArchiveUpload("op");

    expect(sent.at(-1)).toEqual({
      command: "hub_archive_upload_cancel",
      args: { opId: "op" },
    });
  });

  it("hands a page the state each event carries", async () => {
    const seen: unknown[] = [];
    await onArchiveUploadChanged((s) => seen.push(s));

    handler?.({ payload: state });

    expect(listenedTo).toBe(ARCHIVE_UPLOAD_EVENT);
    expect(seen).toEqual([state]);
  });
});
