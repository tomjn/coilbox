import { describe, expect, it } from "vitest";
import { splitOnNames } from "./nameHighlight";

describe("splitOnNames", () => {
  it("matches a whole-word name in the middle of a line", () => {
    const segments = splitOnNames(
      "* HelmMemoryCore1 * aDarkBlueDiamond called a vote",
      ["aDarkBlueDiamond"],
    );
    expect(segments).toEqual([
      { text: "* HelmMemoryCore1 * " },
      { text: "aDarkBlueDiamond", name: "aDarkBlueDiamond" },
      { text: " called a vote" },
    ]);
  });

  it("matches a name that carries a clan tag in brackets", () => {
    const segments = splitOnNames("User(s) allowed to vote: [RoX]pintle", [
      "[RoX]pintle",
    ]);
    expect(segments).toEqual([
      { text: "User(s) allowed to vote: " },
      { text: "[RoX]pintle", name: "[RoX]pintle" },
    ]);
  });

  it("does not match a short name inside a longer word", () => {
    const segments = splitOnNames("Roxanne joined the battle", ["Rox"]);
    expect(segments).toEqual([{ text: "Roxanne joined the battle" }]);
  });

  it("does not match a short name inside a longer username", () => {
    const segments = splitOnNames("aDarkBlueDiamondXL said hi", [
      "aDarkBlueDiamond",
    ]);
    expect(segments).toEqual([{ text: "aDarkBlueDiamondXL said hi" }]);
  });

  it("escapes regex special characters in a name", () => {
    const segments = splitOnNames("say hi to c++Dev now", ["c++Dev"]);
    expect(segments).toEqual([
      { text: "say hi to " },
      { text: "c++Dev", name: "c++Dev" },
      { text: " now" },
    ]);
  });

  it("prefers the longer of two names that share a prefix", () => {
    const segments = splitOnNames("aDarkBlueDiamond is here", [
      "aDarkBlueDiamond",
      "aDarkBlue",
    ]);
    expect(segments).toEqual([
      { text: "aDarkBlueDiamond", name: "aDarkBlueDiamond" },
      { text: " is here" },
    ]);
  });

  it("matches every occurrence of a name in one line", () => {
    const segments = splitOnNames("tomjn: hi tomjn!", ["tomjn"]);
    expect(segments).toEqual([
      { text: "tomjn", name: "tomjn" },
      { text: ": hi " },
      { text: "tomjn", name: "tomjn" },
      { text: "!" },
    ]);
  });

  it("returns the text unchanged when no names are given", () => {
    expect(splitOnNames("hello world", [])).toEqual([{ text: "hello world" }]);
  });

  it("returns the text unchanged when nothing matches", () => {
    expect(splitOnNames("hello world", ["nobody"])).toEqual([
      { text: "hello world" },
    ]);
  });
});
