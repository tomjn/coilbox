import { describe, expect, it } from "vitest";
import { mostRecentOpen } from "./recency";

interface Item {
  id: string;
  open: boolean;
  ts: number;
}

const item = (id: string, open: boolean, ts: number): Item => ({
  id,
  open,
  ts,
});

describe("mostRecentOpen", () => {
  it("returns the open item with the highest timestamp", () => {
    const items = [
      item("a", true, 10),
      item("b", true, 30),
      item("c", true, 20),
    ];
    const result = mostRecentOpen(
      items,
      (i) => i.open,
      (i) => i.ts,
    );
    expect(result?.id).toBe("b");
  });

  it("ignores closed items even if they are more recent", () => {
    const items = [item("a", true, 10), item("b", false, 999)];
    const result = mostRecentOpen(
      items,
      (i) => i.open,
      (i) => i.ts,
    );
    expect(result?.id).toBe("a");
  });

  it("returns undefined when nothing is open", () => {
    const items = [item("a", false, 10), item("b", false, 20)];
    const result = mostRecentOpen(
      items,
      (i) => i.open,
      (i) => i.ts,
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for an empty list", () => {
    const result = mostRecentOpen<Item>(
      [],
      (i) => i.open,
      (i) => i.ts,
    );
    expect(result).toBeUndefined();
  });
});
