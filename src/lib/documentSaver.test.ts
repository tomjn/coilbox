import { describe, expect, it } from "vitest";

import { createDocumentSaver } from "./documentSaver";

describe("createDocumentSaver onQueued", () => {
  it("fires once per save, synchronously, ahead of the write landing", () => {
    const queued: number[] = [];
    // Never resolves, so the write is still in flight when this is checked.
    const write = () => new Promise<string>(() => {});
    const saver = createDocumentSaver<string>({
      write,
      onWritten: () => {},
      onError: () => {},
      onQueued: () => queued.push(queued.length),
    });

    saver.save("a");
    // Fired before the write's promise has had a chance to settle.
    expect(queued).toEqual([0]);

    saver.save("b");
    expect(queued).toEqual([0, 1]);
  });

  it("fires for a write later superseded, which never reaches onWritten", async () => {
    const queued: string[] = [];
    const written: string[] = [];
    const saver = createDocumentSaver<string>({
      write: async (doc) => doc,
      onWritten: (doc) => {
        written.push(doc);
      },
      onError: () => {},
      onQueued: () => queued.push("queued"),
    });

    saver.save("a");
    saver.save("b");
    await saver.settled();

    expect(queued).toEqual(["queued", "queued"]);
    expect(written).toEqual(["b"]);
  });

  it("is optional, so a caller with no interest in it is unaffected", async () => {
    const saver = createDocumentSaver<string>({
      write: async (doc) => doc,
      onWritten: () => {},
      onError: () => {},
    });

    saver.save("a");
    await expect(saver.settled()).resolves.toBeUndefined();
  });
});
