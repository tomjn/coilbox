import { describe, expect, it } from "vitest";

import { panelOpenFrom } from "./panels";

describe("panelOpenFrom", () => {
  it("opens when nothing has been stored", () => {
    expect(panelOpenFrom(null)).toBe(true);
  });

  it("opens on junk rather than throwing or hiding the panel", () => {
    expect(panelOpenFrom("")).toBe(true);
    expect(panelOpenFrom("{}")).toBe(true);
    expect(panelOpenFrom("no")).toBe(true);
  });

  it("closes only on the value it wrote", () => {
    expect(panelOpenFrom("false")).toBe(false);
    expect(panelOpenFrom("true")).toBe(true);
  });
});
