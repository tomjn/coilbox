// @vitest-environment happy-dom

/**
 * What the content gate draws for a requirement with no download (issue
 * #3401). The resolve hook is stood in for, so the test says exactly what is
 * missing and what can be downloaded.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentRequirement } from "../../resolveContent";
import { ResolveContentGate } from "./ResolveContentDrawer";

const state = vi.hoisted(() => ({
  missing: [] as ContentRequirement[],
}));

vi.mock("../../useResolveContent", () => ({
  useResolveContent: () => ({
    loading: false,
    unreadable: false,
    unreadableReason: null,
    missing: state.missing,
    resolved: false,
    download: vi.fn(),
    statusFor: () => null,
    itemFor: () => null,
    errorFor: () => null,
    canDownload: (req: ContentRequirement) => !req.noDownload,
    noWriteRoot: false,
  }),
}));
vi.mock("../../../downloads/pages/components/ProgressBar", () => ({
  QueueProgress: () => null,
}));

afterEach(cleanup);

const game = (over: Partial<ContentRequirement>): ContentRequirement => ({
  kind: "game",
  label: "Mystery Game",
  isInstalled: () => false,
  ...over,
});

function renderGate(req: ContentRequirement) {
  state.missing = [req];
  render(
    <MemoryRouter>
      <ResolveContentGate
        title="Set up this challenge"
        requirements={[req]}
        target={{ enginePath: "/e", dataDir: "/d" }}
        onContinue={() => {}}
        onCancel={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("ResolveContentGate for a game with no download", () => {
  it("shows a message pointing at Content > Games and no Download button", () => {
    renderGate(game({ noDownload: true }));
    expect(screen.getByText(/no download/i)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /Content > Games/ })
        .getAttribute("href"),
    ).toBe("/library/games");
    expect(screen.queryByRole("button", { name: /^Download/ })).toBeNull();
  });

  it("still offers Download for a game that has one", () => {
    renderGate(game({ downloadKey: "mystery:test" }));
    expect(screen.getByRole("button", { name: /^Download/ })).toBeTruthy();
    expect(screen.queryByText(/no download/i)).toBeNull();
  });
});
