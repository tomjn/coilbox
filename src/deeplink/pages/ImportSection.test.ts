/**
 * What the import box says it takes (issue #1515).
 *
 * The list under the paste field was written out by hand, fell two kinds
 * behind, and was then removed rather than corrected. It is built from the
 * kinds now, and this is what holds it to them: the sentence's own test lives
 * in `../../container/names.test.ts`, and this is the evidence that the box on
 * screen is the one saying it.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { CONTAINER_KINDS } from "@/container/container";
import { containerKindName } from "@/container/names";

// The file picker and the file reader are the Tauri side, and neither is
// touched by rendering the box.
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => null }));
vi.mock("../bindings", () => ({ importContainerFile: async () => ({}) }));

const { default: ImportSection } = await import("./ImportSection");

function markup(): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(ImportSection)),
  );
}

describe("the import box", () => {
  it("names every kind a container can hold", () => {
    const html = markup();
    for (const kind of CONTAINER_KINDS) {
      expect(html).toContain(`a ${containerKindName(kind)}`);
    }
  });
});
