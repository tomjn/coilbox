import { describe, expect, it } from "vitest";
import { usableRapidRepos } from "./rapidMasters";

describe("usableRapidRepos", () => {
  it("drops a row with no address yet", () => {
    expect(
      usableRapidRepos([
        { id: "a", name: "Spring", url: "https://repos.springrts.com" },
        { id: "b", name: "", url: "" },
        { id: "c", name: "Half typed", url: "   " },
      ]).map((r) => r.id),
    ).toEqual(["a"]);
  });

  it("trims addresses and keeps a repeated one once", () => {
    expect(
      usableRapidRepos([
        { id: "a", name: "One", url: " https://a.test " },
        { id: "b", name: "Two", url: "https://a.test" },
      ]),
    ).toEqual([{ id: "a", name: "One", url: "https://a.test" }]);
  });
});
