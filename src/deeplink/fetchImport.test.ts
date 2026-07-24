import { describe, expect, it, vi } from "vitest";
import { encodeContainerCode } from "../container/container";
import { type FetchText, fetchImportPlan } from "./fetchImport";

const presetPayload = {
  participants: [],
  gameName: "Balanced Annihilation",
  mapName: "Comet Catcher",
  startPosType: 2,
  modOptionValues: {},
};

/** A fetcher that returns fixed text. */
const returns =
  (text: string): FetchText =>
  async () => ({ ok: true, text });

/** A fetcher that fails with a reason (what the Rust command surfaces for a
 * network error, timeout, non-200, or oversized response). */
const fails =
  (reason: string): FetchText =>
  async () => ({ ok: false, reason });

describe("fetchImportPlan", () => {
  it("fetches, validates, and plans a valid preset container", async () => {
    const code = encodeContainerCode("preset", 1, presetPayload);
    const r = await fetchImportPlan("https://example.com/p.txt", returns(code));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.kind).toBe("preset");
      expect(r.plan.route).toContain("/play/skirmish?import=");
      expect(r.host).toBe("example.com");
    }
  });

  it("accepts raw container JSON, not only a base64 code", async () => {
    const json = JSON.stringify({
      format: "coilbox",
      container: 1,
      kind: "preset",
      kindVersion: 1,
      payload: presetPayload,
    });
    const r = await fetchImportPlan(
      "https://example.com/p.json",
      returns(json),
    );
    expect(r.ok).toBe(true);
  });

  it("carries a newer-version warning through", async () => {
    const code = encodeContainerCode("preset", 99, presetPayload);
    const r = await fetchImportPlan("https://example.com/p.txt", returns(code));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.compatibility).toBe("newer");
      expect(r.plan.warnings.length).toBeGreaterThan(0);
    }
  });

  it("rejects content that is not a coilbox container", async () => {
    const r = await fetchImportPlan(
      "https://example.com/x",
      returns("just some html"),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not a coilbox import/i);
  });

  it("rejects a non-https URL without fetching", async () => {
    const fetchText = vi.fn(returns("x"));
    const r = await fetchImportPlan("http://example.com/p.txt", fetchText);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/https/i);
    expect(fetchText).not.toHaveBeenCalled();
  });

  it("surfaces an oversized rejection from the fetcher", async () => {
    const r = await fetchImportPlan(
      "https://example.com/p.txt",
      fails("That import is too large to be a coilbox import."),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too large/i);
  });

  it("surfaces a non-200 rejection from the fetcher", async () => {
    const r = await fetchImportPlan(
      "https://example.com/missing",
      fails("The host returned an error (404)."),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/404/);
  });

  it("surfaces an unreachable-host rejection from the fetcher", async () => {
    const r = await fetchImportPlan(
      "https://nope.invalid/p.txt",
      fails("Could not reach the host."),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/could not reach/i);
  });

  it("surfaces a timeout rejection from the fetcher", async () => {
    const r = await fetchImportPlan(
      "https://slow.example.com/p.txt",
      fails("The host took too long to respond."),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too long/i);
  });
});
