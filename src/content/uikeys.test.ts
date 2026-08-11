import { describe, expect, it } from "vitest";
import {
  actionCommand,
  applyUikeys,
  emptyState,
  formatKeySet,
  normaliseKeys,
  parseKeySet,
  parseUikeys,
  serialiseUikeys,
  type UikeysState,
} from "./uikeys";

/** Run a uikeys source against a fresh state. */
function run(text: string, from: UikeysState = emptyState()): UikeysState {
  return applyUikeys(from, parseUikeys(text));
}

describe("keysets", () => {
  it("expands the engine's modifier abbreviations", () => {
    expect(normaliseKeys("c+a")).toBe("Ctrl+a");
    expect(normaliseKeys("Ctrl+a")).toBe("Ctrl+a");
    expect(normaliseKeys("*+tab")).toBe("Any+tab");
  });

  it("orders modifiers the way the engine prints them", () => {
    expect(normaliseKeys("shift+ctrl+alt+any+x")).toBe("Any+Alt+Ctrl+Shift+x");
  });

  it("keeps plus signs that are the key rather than a separator", () => {
    expect(normaliseKeys("Alt++")).toBe("Alt++");
    expect(normaliseKeys("Alt+numpad+")).toBe("Alt+numpad+");
  });

  it("keeps keycode and scancode forms verbatim", () => {
    expect(normaliseKeys("0x1b")).toBe("0x1b");
    expect(normaliseKeys("Ctrl+sc_a")).toBe("Ctrl+sc_a");
  });

  it("drops the deprecated Up modifier the way the engine does", () => {
    expect(normaliseKeys("Up+a")).toBe("a");
  });

  it("round trips a keychain", () => {
    expect(normaliseKeys("Alt+ctrl+a,Alt+ctrl+a")).toBe(
      "Alt+Ctrl+a,Alt+Ctrl+a",
    );
  });

  it("rejects a token with no key", () => {
    expect(parseKeySet("Ctrl+")).toBeNull();
    expect(normaliseKeys("")).toBeNull();
  });

  it("formats what it parsed", () => {
    const ks = parseKeySet("s+f5");
    expect(ks).not.toBeNull();
    expect(formatKeySet(ks as NonNullable<typeof ks>)).toBe("Shift+f5");
  });
});

describe("bind", () => {
  it("appends bindings in file order", () => {
    const s = run("bind a firstaction\nbind b secondaction\n");
    expect(s.bindings).toEqual([
      { keys: "a", action: "firstaction" },
      { keys: "b", action: "secondaction" },
    ]);
  });

  it("keeps several actions on one keyset, as the engine does", () => {
    const s = run("bind Any+tab toggleoverview\nbind Any+tab edit_complete\n");
    expect(s.bindings.map((b) => b.action)).toEqual([
      "toggleoverview",
      "edit_complete",
    ]);
  });

  it("ignores an identical re-bind", () => {
    const s = run("bind a chat\nbind a chat\n");
    expect(s.bindings).toHaveLength(1);
  });

  it("forces Any onto a stateful command", () => {
    const s = run("bind w moveforward\n");
    expect(s.bindings[0]?.keys).toBe("Any+w");
  });

  it("keeps an action's arguments verbatim", () => {
    const s = run(
      "bind Ctrl+b select AllMap+_Builder_Idle+_ClearSelection_SelectOne+\n",
    );
    expect(s.bindings[0]?.action).toBe(
      "select AllMap+_Builder_Idle+_ClearSelection_SelectOne+",
    );
  });

  it("skips a bind whose key does not parse", () => {
    const s = run("bind Ctrl+ chat\n");
    expect(s.bindings).toHaveLength(0);
  });
});

describe("unbind", () => {
  it("matches on the action's first word only", () => {
    const before = run("bind [ buildfacing inc\n");
    expect(run("unbind [ buildfacing inc\n", before).bindings).toHaveLength(1);
    expect(run("unbind [ buildfacing\n", before).bindings).toHaveLength(0);
  });

  it("is a no-op for a binding that is not there", () => {
    const before = run("bind a chat\n");
    expect(run("unbind b chat\n", before).bindings).toHaveLength(1);
  });

  it("unbindaction removes the action from every keyset", () => {
    const before = run("bind a chat\nbind Shift+b chat\nbind c gameinfo\n");
    const after = run("unbindaction chat\n", before);
    expect(after.bindings).toEqual([{ keys: "c", action: "gameinfo" }]);
  });

  it("unbindkeyset removes every action on that keyset", () => {
    const before = run(
      "bind Any+tab toggleoverview\nbind Any+tab edit_complete\nbind c gameinfo\n",
    );
    const after = run("unbindkeyset Any+tab\n", before);
    expect(after.bindings).toEqual([{ keys: "c", action: "gameinfo" }]);
  });

  it("unbindall clears everything and leaves enter chat behind", () => {
    const before = run("bind a chat\nkeysym mykey 0x41\n");
    const after = run("unbindall\n", before);
    expect(after.bindings).toEqual([{ keys: "enter", action: "chat" }]);
    expect(after.keysyms).toEqual([]);
  });
});

describe("other commands", () => {
  it("records fakemeta and none", () => {
    expect(run("fakemeta space\n").fakeMeta).toBe("space");
    expect(run("fakemeta none\n").fakeMeta).toBeNull();
  });

  it("records keysyms", () => {
    expect(run("keysym mykey 0x41\n").keysyms).toEqual([
      { name: "mykey", code: "0x41" },
    ]);
  });

  it("records an include without following it", () => {
    const s = run("keyload other.txt\nbind a chat\n");
    expect(s.includes).toEqual(["other.txt"]);
    expect(s.bindings).toHaveLength(1);
  });

  it("preserves a line it does not execute", () => {
    expect(run("keydebug 1\n").preserved).toEqual(["keydebug 1"]);
  });

  it("ignores comments and blank lines", () => {
    const s = run("// a comment\n\nbind a chat // trailing\n");
    expect(s.bindings).toEqual([{ keys: "a", action: "chat" }]);
    expect(s.preserved).toEqual([]);
  });
});

describe("actionCommand", () => {
  it("takes the lowercased first word", () => {
    expect(actionCommand("BuildFacing inc")).toBe("buildfacing");
    expect(actionCommand("  chat  ")).toBe("chat");
  });
});

describe("serialise", () => {
  it("writes a file that reads back to the same state", () => {
    const before = run(
      "fakemeta space\nkeysym mykey 0x41\nbind Any+tab toggleoverview\nbind Ctrl+b select AllMap+_Builder_Idle+_ClearSelection_SelectOne+\nkeydebug 1\n",
    );
    const after = run(serialiseUikeys(before));
    expect(after.bindings).toEqual(before.bindings);
    expect(after.fakeMeta).toBe(before.fakeMeta);
    expect(after.keysyms).toEqual(before.keysyms);
    expect(after.preserved).toEqual(before.preserved);
  });

  it("clears the engine defaults before its own bindings", () => {
    const text = serialiseUikeys(run("bind a chat\n"));
    const lines = text.split("\n").map((l) => l.trim());
    expect(lines).toContain("unbindall          // clear the defaults");
    expect(lines).toContain("unbind enter chat  // clear the defaults");
  });

  it("marks the file as coilbox's", () => {
    expect(
      serialiseUikeys(emptyState()).startsWith("// Written by coilbox"),
    ).toBe(true);
  });
});
