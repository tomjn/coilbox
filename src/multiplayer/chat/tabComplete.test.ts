import { describe, expect, it } from "vitest";
import { completeNick } from "./tabComplete";

const members = ["alice", "Albert", "bob", "Charlie"];

describe("completeNick", () => {
  it("completes a prefix at the start of the input with a colon suffix", () => {
    const r = completeNick("al", 2, members, null);
    expect(r).not.toBeNull();
    // Albert sorts before alice case-insensitively? localeCompare base: "albert" < "alice"
    expect(r?.value).toBe("Albert: ");
    expect(r?.cursor).toBe("Albert: ".length);
  });

  it("uses a plain space suffix mid-message", () => {
    const r = completeNick("hi al", 5, members, null);
    expect(r?.value).toBe("hi Albert ");
    expect(r?.cursor).toBe("hi Albert ".length);
  });

  it("cycles to the next match on repeated Tab", () => {
    const first = completeNick("al", 2, members, null);
    expect(first?.value).toBe("Albert: ");
    const second = completeNick(
      first?.value ?? "",
      first?.cursor ?? 0,
      members,
      first?.cycle ?? null,
    );
    expect(second?.value).toBe("alice: ");
    // wraps back around
    const third = completeNick(
      second?.value ?? "",
      second?.cursor ?? 0,
      members,
      second?.cycle ?? null,
    );
    expect(third?.value).toBe("Albert: ");
  });

  it("is case-insensitive on the prefix", () => {
    const r = completeNick("BO", 2, members, null);
    expect(r?.value).toBe("bob: ");
  });

  it("returns null when nothing matches", () => {
    expect(completeNick("zz", 2, members, null)).toBeNull();
  });

  it("returns null on an empty token (cursor after whitespace)", () => {
    expect(completeNick("hi ", 3, members, null)).toBeNull();
  });

  it("preserves text after the cursor when completing mid-string", () => {
    const r = completeNick("al end", 2, members, null);
    expect(r?.value).toBe("Albert:  end");
  });

  it("restarts the cycle when the user edits between Tabs", () => {
    const first = completeNick("al", 2, members, null);
    // user typed something else; produced no longer matches value
    const r = completeNick("bo", 2, members, first?.cycle ?? null);
    expect(r?.value).toBe("bob: ");
  });
});
