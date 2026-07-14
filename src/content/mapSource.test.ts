import { describe, expect, it } from "vitest";
import type { SuggestedMap } from "./branding";
import { BAR_SEARCH_URL, withMapSource } from "./mapSource";

const mapItem = (searchUrl?: string): SuggestedMap => ({
  id: "m",
  title: "M",
  download: { kind: "map", springName: "Some Map v1", searchUrl },
});

describe("withMapSource", () => {
  it("defaults a missing searchUrl to BAR", () => {
    const out = withMapSource(mapItem());
    expect(out.download).toMatchObject({ searchUrl: BAR_SEARCH_URL });
  });

  it("defaults a blank searchUrl to BAR", () => {
    const out = withMapSource(mapItem("   "));
    expect(out.download).toMatchObject({ searchUrl: BAR_SEARCH_URL });
  });

  it("keeps an explicit searchUrl untouched", () => {
    const explicit = "https://springfiles.springrts.com/json.php";
    const out = withMapSource(mapItem(explicit));
    expect(out.download).toMatchObject({ searchUrl: explicit });
  });

  it("leaves non-map downloads alone", () => {
    const rapid: SuggestedMap = {
      id: "g",
      title: "G",
      download: { kind: "rapid", tag: "byar:test" },
    };
    expect(withMapSource(rapid)).toBe(rapid);
  });
});
