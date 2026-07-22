import { describe, expect, it, vi } from "vitest";

// notes.ts imports `useSetting` from @picoframe/frame, whose published dist uses
// extensionless relative imports Vitest's node resolver won't load. These pure-helper
// tests never call the hook, so stubbing it is enough to let the module import (same
// pattern as ignore.test.ts).
vi.mock("@picoframe/frame", () => ({
  useSetting: () => [{}, () => {}],
}));

import { getNote, NOTE_MAX_LENGTH, noteKey, setNote } from "./notes";

const KEY = "me@host:8200";
const OTHER = "me@other:8200";

describe("noteKey", () => {
  it("keys on account id when present", () => {
    expect(noteKey("42", "Bob")).toBe("id:42");
  });

  it("falls back to the lowercased name when there's no account id", () => {
    expect(noteKey(undefined, "Bob")).toBe("name:bob");
    expect(noteKey("", "Bob")).toBe("name:bob");
    expect(noteKey("   ", "Bob")).toBe("name:bob");
  });
});

describe("setNote / getNote", () => {
  it("sets and reads back a note", () => {
    const map = setNote({}, KEY, "42", "Bob", "smurf");
    expect(getNote(map, KEY, "42", "Bob")).toBe("smurf");
  });

  it("trims whitespace", () => {
    const map = setNote({}, KEY, "42", "Bob", "  smurf  ");
    expect(getNote(map, KEY, "42", "Bob")).toBe("smurf");
  });

  it("caps to NOTE_MAX_LENGTH", () => {
    const long = "x".repeat(NOTE_MAX_LENGTH + 50);
    const map = setNote({}, KEY, "42", "Bob", long);
    expect(getNote(map, KEY, "42", "Bob")).toHaveLength(NOTE_MAX_LENGTH);
  });

  it("an empty/whitespace-only note deletes the entry", () => {
    let map = setNote({}, KEY, "42", "Bob", "smurf");
    map = setNote(map, KEY, "42", "Bob", "   ");
    expect(getNote(map, KEY, "42", "Bob")).toBe("");
    expect(map).toEqual({});
  });

  it("clearing an already-absent note is a no-op (returns the same map)", () => {
    const map = { [KEY]: { "id:42": "smurf" } };
    expect(setNote(map, KEY, "1", "Alice", "")).toBe(map);
  });

  it("falls back to the name when userId is missing", () => {
    const map = setNote({}, KEY, undefined, "Bob", "smurf");
    expect(getNote(map, KEY, undefined, "Bob")).toBe("smurf");
    // Case-insensitive, matching the wire's nick handling.
    expect(getNote(map, KEY, undefined, "BOB")).toBe("smurf");
  });

  it("is safe against a missing account id and an unknown player", () => {
    expect(getNote({}, KEY, undefined, "Nobody")).toBe("");
    expect(getNote({ [KEY]: {} }, KEY, "42", "Bob")).toBe("");
  });

  it("keeps serverKeys isolated", () => {
    const map = setNote({}, KEY, "42", "Bob", "smurf");
    expect(getNote(map, OTHER, "42", "Bob")).toBe("");
  });

  it("keeps two players on the same server isolated", () => {
    let map = setNote({}, KEY, "1", "Alice", "good teammate");
    map = setNote(map, KEY, "2", "Bob", "smurf");
    expect(getNote(map, KEY, "1", "Alice")).toBe("good teammate");
    expect(getNote(map, KEY, "2", "Bob")).toBe("smurf");
  });
});
