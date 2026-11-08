import { describe, expect, it } from "vitest";
import { defaultAdvanced } from "./pages/components/AdvancedOptions";
import { fillSources, settleNoclamp } from "./recompile";

const on = { ...defaultAdvanced, heightmap: "/d/h.png", noclamp: true };

describe("settleNoclamp", () => {
  it("keeps the no-clamp Recompile set while the heightmap is unchanged", () => {
    const next = { ...on, minh: "-53" };
    expect(settleNoclamp(on, next, "/d/h.png")).toEqual({
      opts: next,
      autoFor: "/d/h.png",
    });
  });

  it("turns it off when another heightmap is picked", () => {
    const r = settleNoclamp(on, { ...on, heightmap: "/mine.png" }, "/d/h.png");
    expect(r.opts.noclamp).toBe(false);
    expect(r.autoFor).toBeNull();
  });

  it("leaves the mapper's own choice alone once they tick or untick the box", () => {
    const off = { ...on, noclamp: false };
    expect(settleNoclamp(on, off, "/d/h.png").autoFor).toBeNull();
    const later = { ...off, heightmap: "/mine.png", noclamp: true };
    expect(settleNoclamp(off, later, null).opts.noclamp).toBe(true);
  });

  it("does nothing when Recompile set nothing", () => {
    const next = { ...defaultAdvanced, heightmap: "/mine.png", noclamp: true };
    expect(settleNoclamp(defaultAdvanced, next, null).opts).toEqual(next);
  });
});

describe("fillSources", () => {
  it("does not overwrite a source that is already set", () => {
    const a = { ...defaultAdvanced, metalmap: "/mine/m.png" };
    expect(fillSources(a, { metalmap: "/d/m.png" }, false).metalmap).toBe(
      "/mine/m.png",
    );
  });

  it("leaves clamping alone outside Recompile", () => {
    expect(
      fillSources(defaultAdvanced, { heightmap: "/d/h.png" }, false).noclamp,
    ).toBe(false);
  });
});
