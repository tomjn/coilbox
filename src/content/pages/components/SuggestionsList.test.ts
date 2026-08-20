import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { WriteRoot } from "../../../downloads/config";
import type { SuggestedGame } from "../../branding";

// The list pulls in picoframe and the download bindings, whose published dists
// use extensionless relative imports Vitest's node resolver won't load from
// node_modules. Nothing here downloads anything, so stubbing the leaves is
// enough (same approach as home/suggestedMap.test.ts).
vi.mock("@picoframe/frame", () => ({
  Button: (props: { children?: ReactNode; disabled?: boolean }) =>
    createElement(
      "button",
      { type: "button", disabled: props.disabled },
      props.children,
    ),
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
}));
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {},
  invoke: async () => ({}),
}));
// Each card now runs its download on the app-wide queue, which needs a provider
// this render has no reason to stand up. `downloadQueue.dom.test.tsx` covers the
// queue itself. Here the card is only being asked what it says about the folder.
vi.mock("../../../downloads/useQueuedDownload", () => ({
  useQueuedDownload: () => ({
    start: async () => null,
    status: null,
    progress: null,
    error: null,
    busy: false,
  }),
}));

const { SuggestionsList } = await import("./SuggestionsList");

const item: SuggestedGame = {
  id: "g1",
  title: "A game",
  download: { kind: "rapid", tag: "byar:test" },
};

function render(writeRoot: WriteRoot): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(SuggestionsList, {
        kind: "game",
        items: [item],
        writeRoot,
      }),
    ),
  );
}

describe("the suggestions list on the download folder", () => {
  it("says nothing about a folder it has not read yet", () => {
    // The folder takes a disk read, so `path` is undefined on the first render
    // of every visit, configured or not. Keyed on that, the list told a
    // configured user to set a folder they had set (issue #1104). The download
    // stays disabled, because there is genuinely nowhere to write to yet.
    const html = render({ loading: true });
    expect(html).not.toContain("Downloads settings");
    expect(html).toContain("disabled");
  });

  it("asks for a folder once the read says there is none", () => {
    const html = render({ loading: false });
    expect(html).toContain("Downloads settings");
    expect(html).toContain("disabled");
  });

  it("says nothing, and offers the download, once a folder is read", () => {
    const html = render({ path: "/data", loading: false });
    expect(html).not.toContain("Downloads settings");
    expect(html).not.toContain("disabled");
  });
});
