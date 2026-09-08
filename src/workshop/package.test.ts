/**
 * The one pure function here worth a test on its own: the file name a
 * packaged archive gets (issue #1283). Everything else in `package.ts` is a
 * thin `defineCommand` binding, exercised by
 * `PackageMutatorButton.dom.test.tsx` instead.
 */
import { describe, expect, it } from "vitest";
import { packagedMutatorFileName } from "./package";

describe("packagedMutatorFileName", () => {
  it("slugs the project's own name and appends the version", () => {
    const project = {
      id: "p1",
      name: "Faster Commanders!",
      gameName: "Balanced Annihilation V15.9.8",
      edits: { overrides: {}, clones: {}, menus: {}, text: {}, disabled: [] },
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z",
    };
    expect(packagedMutatorFileName(project, 3)).toBe(
      "faster-commanders-v3.sdz",
    );
  });

  it("falls back to a generic name for a project nobody named", () => {
    const project = {
      id: "p1",
      name: "   ",
      gameName: "Balanced Annihilation V15.9.8",
      edits: { overrides: {}, clones: {}, menus: {}, text: {}, disabled: [] },
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z",
    };
    expect(packagedMutatorFileName(project, 1)).toBe("tweak-project-v1.sdz");
  });
});
