import { beforeEach, describe, expect, it, vi } from "vitest";

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock("../notify/notify", () => ({ notify }));

import { withDownloadNotify } from "./downloadNotify";

describe("withDownloadNotify", () => {
  beforeEach(() => notify.mockClear());

  it("notifies success and resolves with the original value", async () => {
    const inner = vi.fn().mockResolvedValue({ ok: 1 });
    const wrapped = withDownloadNotify(inner, (a: { tag: string }) => a.tag);
    await expect(wrapped({ tag: "byar:test" })).resolves.toEqual({ ok: 1 });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ level: "success", body: "byar:test" }),
    );
  });

  it("notifies error and re-throws on failure", async () => {
    const boom = new Error("disk full");
    const inner = vi.fn().mockRejectedValue(boom);
    const wrapped = withDownloadNotify(inner, (a: { tag: string }) => a.tag);
    await expect(wrapped({ tag: "byar:test" })).rejects.toThrow("disk full");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", body: "byar:test" }),
    );
  });

  it("does not notify when the download was cancelled", async () => {
    const inner = vi.fn().mockRejectedValue(new Error("download cancelled"));
    const wrapped = withDownloadNotify(inner, (a: { tag: string }) => a.tag);
    await expect(wrapped({ tag: "byar:test" })).rejects.toThrow();
    expect(notify).not.toHaveBeenCalled();
  });

  it("treats a non-Error cancellation value as a cancellation", async () => {
    const inner = vi.fn().mockRejectedValue("operation cancelled");
    const wrapped = withDownloadNotify(inner, (a: { tag: string }) => a.tag);
    await expect(wrapped({ tag: "byar:test" })).rejects.toBe(
      "operation cancelled",
    );
    expect(notify).not.toHaveBeenCalled();
  });
});
