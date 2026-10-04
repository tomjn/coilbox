// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../play/pages/components/DownloadGameButton", () => ({
  DownloadGameButton: () => null,
}));
vi.mock("../../../play/pages/components/NoEngineNotice", () => ({
  NoEngineNotice: () => null,
}));

import { RunContentNotice } from "./RunContentNotice";

afterEach(cleanup);

function renderNotice(reason: string | null) {
  render(
    <MemoryRouter>
      <RunContentNotice
        notice={{ kind: "unreadable", reason }}
        game={{ shortname: "ba" }}
        targetLoading={false}
        refreshTarget={async () => {}}
        refreshScan={async () => {}}
      />
    </MemoryRouter>,
  );
}

describe("RunContentNotice when the games could not be read", () => {
  it("shows why the scan failed", () => {
    renderNotice("no space left on device");
    expect(screen.getByText(/no space left on device/)).toBeTruthy();
    expect(screen.getByText(/could not read your games/)).toBeTruthy();
  });

  it("says nothing about a reason when there is none", () => {
    renderNotice(null);
    expect(screen.queryByText(/unitsync said/)).toBeNull();
  });
});
