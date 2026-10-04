// @vitest-environment happy-dom

/**
 * The skirmish page's no-engine notice (issue #3365): it offers the newest
 * catalog engine through the shared launch check, reads the engines again once
 * the check says the engine is installed, and keeps the settings message when
 * there is nothing to download into.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoEngineNotice } from "./NoEngineNotice";

const mocks = vi.hoisted(() => ({
  writeRoot: { loading: false, path: "/content" as string | undefined },
  newest: { version: "2025.06.12" as string | null },
  ensureContent: vi.fn(),
}));

vi.mock("@/downloads/config", () => ({ useWriteRoot: () => mocks.writeRoot }));
vi.mock("@/downloads/engineInstall", () => ({
  fetchNewestRecoil: async () => ({
    release: mocks.newest.version ? { version: mocks.newest.version } : null,
    platform: "test",
  }),
}));
vi.mock("../../LaunchContentProvider", () => ({
  useLaunchContent: () => ({ ensureContent: mocks.ensureContent }),
}));

const renderNotice = (refresh = vi.fn(async () => {})) => {
  render(
    <MemoryRouter>
      <NoEngineNotice targetLoading={false} refresh={refresh} />
    </MemoryRouter>,
  );
  return refresh;
};

const downloadButton = () =>
  screen.getByRole("button", { name: "Download engine" }) as HTMLButtonElement;

beforeEach(() => {
  mocks.writeRoot = { loading: false, path: "/content" };
  mocks.newest = { version: "2025.06.12" };
  mocks.ensureContent.mockReset();
});
afterEach(cleanup);

describe("NoEngineNotice", () => {
  it("asks the launch check for the offered engine, then reads the engines again", async () => {
    mocks.ensureContent.mockResolvedValue({ ready: true, target: {} });
    const refresh = renderNotice();

    fireEvent.click(
      await screen.findByRole("button", { name: "Download engine" }),
    );

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const request = mocks.ensureContent.mock.calls[0][0];
    expect(
      request.requirements.map((r: { kind: string; label: string }) => [
        r.kind,
        r.label,
      ]),
    ).toEqual([["engine", "2025.06.12"]]);
  });

  it("does not read the engines again when the player cancels", async () => {
    mocks.ensureContent.mockResolvedValue({
      ready: false,
      reason: "cancelled",
    });
    const refresh = renderNotice();

    fireEvent.click(
      await screen.findByRole("button", { name: "Download engine" }),
    );

    await waitFor(() => expect(mocks.ensureContent).toHaveBeenCalled());
    await waitFor(() => expect(downloadButton().disabled).toBe(false));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps the settings message and link when no folder can be written to", async () => {
    mocks.writeRoot = { loading: false, path: undefined };
    renderNotice();

    const link = await screen.findByRole("link", { name: /Content folders/ });
    expect(link.getAttribute("href")).toBe("/settings/content-folders");
    expect(
      screen.queryByRole("button", { name: "Download engine" }),
    ).toBeNull();
  });
});
