import { beforeEach, describe, expect, it, vi } from "vitest";

const dlFetchText = vi.hoisted(() => vi.fn());
vi.mock("../downloads/bindings", () => ({ dlFetchText }));

import { fetchImportText } from "./fetchText";

beforeEach(() => dlFetchText.mockClear());

describe("fetchImportText", () => {
  it("returns the text the command fetched", async () => {
    dlFetchText.mockResolvedValue({ text: "abc" });
    expect(await fetchImportText("https://example.test/a")).toEqual({
      ok: true,
      text: "abc",
    });
  });

  it("reads a coded failure as its sentence and not as JSON", async () => {
    const failure = new Error(
      JSON.stringify({
        code: "downloads.fetch.status",
        params: { status: "404" },
        fallback: "The host returned an error (404).",
      }),
    );
    dlFetchText.mockRejectedValueOnce(failure);
    expect(await fetchImportText("https://example.test/a")).toEqual({
      ok: false,
      reason: "The host returned an error (404).",
    });
  });
});
