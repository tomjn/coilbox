import { describe, expect, it } from "vitest";
import { insideSection } from "./nav";

describe("insideSection", () => {
  const workshop = insideSection("/workshop");

  it("lights the item on the section's own path", () => {
    expect(workshop("/workshop")).toBe(true);
  });

  it("stays lit on a project and on the editor with no project yet", () => {
    expect(workshop("/workshop/6f1c-4b2e")).toBe(true);
    expect(workshop("/workshop/new")).toBe(true);
  });

  it("goes out elsewhere, including on a path the name starts", () => {
    expect(workshop("/lego")).toBe(false);
    expect(workshop("/workshopping")).toBe(false);
  });

  it("leaves a sibling's paths to the sibling", () => {
    const lego = insideSection("/lego", ["/lego/parts"]);
    expect(lego("/lego")).toBe(true);
    expect(lego("/lego/6f1c-4b2e")).toBe(true);
    expect(lego("/lego/parts")).toBe(false);
    expect(lego("/lego/parts/anything")).toBe(false);
  });
});
