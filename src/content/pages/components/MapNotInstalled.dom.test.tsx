// @vitest-environment happy-dom

/**
 * Where a shared map link lands for somebody without the map (issue #286).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  writePath: "/d" as string | undefined,
  start: vi.fn(() => Promise.resolve({ status: "done" })),
}));

vi.mock("../../../downloads/config", () => ({
  useWriteRootPath: () => hoisted.writePath,
}));
vi.mock("../../../downloads/useQueuedDownload", () => ({
  useQueuedDownload: () => ({
    start: hoisted.start,
    status: null,
    progress: null,
    error: null,
    busy: false,
  }),
}));

import { MapNotInstalled } from "./MapNotInstalled";

const draw = (onDownloaded = () => {}) =>
  render(
    <MemoryRouter>
      <MapNotInstalled mapName="Comet v1" onDownloaded={onDownloaded} />
    </MemoryRouter>,
  );

beforeEach(() => {
  hoisted.writePath = "/d";
  hoisted.start.mockClear();
});
afterEach(cleanup);

it("downloads the map and tells the page once it has landed", async () => {
  const onDownloaded = vi.fn();
  draw(onDownloaded);
  expect(screen.getByText("Comet v1")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  expect(hoisted.start).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(onDownloaded).toHaveBeenCalledOnce());
});

it("will not start a download with no folder to put it in", () => {
  hoisted.writePath = undefined;
  draw();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Download" })
      .disabled,
  ).toBe(true);
});
