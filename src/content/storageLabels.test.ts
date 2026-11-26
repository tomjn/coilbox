import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CACHE_LABELS, CATEGORY_LABELS } from "./storageLabels";

/**
 * The Storage page translates Rust's English category and cache names by id.
 * These read the Rust source, as `engineSettingText.test.ts` does, and fail
 * when the two disagree.
 */

const SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "crates/tauri-plugin-coilbox-content/src",
);
const read = (file: string) => readFileSync(join(SRC, file), "utf8");

describe("the storage label tables", () => {
  it("has every storage category, in the same English", () => {
    const source = read("storage.rs");
    const found = Object.fromEntries(
      [...source.matchAll(/tally\(\s*"(\w+)",\s*"([^"]+)"/g)].map((m) => [
        m[1],
        m[2],
      ]),
    );
    const other = source.match(/id: "other"\.into\(\),\s*label: "([^"]+)"/);
    expect(other, "the Other category was not found").toBeTruthy();
    found.other = other?.[1] ?? "";
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual(
      Object.keys(found).sort(),
    );
    for (const [id, label] of Object.entries(found))
      expect(CATEGORY_LABELS[id].message, id).toBe(label);
  });

  it("has every cache, in the same English", () => {
    const source = read("caches.rs");
    const table = source.slice(
      source.indexOf("const CACHE_SUBDIRS"),
      source.indexOf("];", source.indexOf("const CACHE_SUBDIRS")),
    );
    const dirOf = (module: string) =>
      read(`demo/${module}.rs`).match(/const CACHE_DIR: &str = "([^"]+)"/)?.[1];
    const found: Record<string, string> = {};
    for (const m of table.matchAll(
      /\((?:"([^"]+)"|crate::demo::(\w+)::CACHE_DIR),\s*"([^"]+)"\)/g,
    )) {
      const name = m[1] ?? dirOf(m[2]);
      expect(name, `the cache dir for ${m[2]}`).toBeTruthy();
      found[name as string] = m[3];
    }
    expect(Object.keys(CACHE_LABELS).sort()).toEqual(Object.keys(found).sort());
    for (const [name, label] of Object.entries(found))
      expect(CACHE_LABELS[name].message, name).toBe(label);
  });
});
