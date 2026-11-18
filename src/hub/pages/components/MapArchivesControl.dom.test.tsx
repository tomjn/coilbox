// @vitest-environment happy-dom

/**
 * The bulk map upload section in Settings > Coilbox hub. `bulkMaps.test.ts`
 * covers finding and the queue. This covers what a person sees: nothing until
 * signed in, the maps found with the ones that cannot go up apart, unticking
 * one, and the run with its Stop button.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ArchiveFacts } from "../../archiveUploads";
import type { BulkFindResult, BulkRun } from "../../upload/bulkMaps";

let signedIn = true;
vi.mock("../../account", () => ({
  useHubAccount: () => ({ signedIn }),
}));
vi.mock("@/profile/profile", () => ({ isHubAssetUploadOffered: () => true }));
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({
    target: { enginePath: "/engines/105", dataDir: "/data" },
  }),
}));

const find = vi.hoisted(() => vi.fn<() => Promise<BulkFindResult>>());
const upload = vi.hoisted(() => vi.fn());
const stop = vi.hoisted(() => vi.fn());
let run: BulkRun | null = null;
vi.mock("../../upload/bulkMaps", () => ({
  findMissingMaps: find,
  runBulkUpload: upload,
  stopBulkUpload: stop,
  useBulkRun: () => run,
}));

import { MapArchivesControl } from "./MapArchivesControl";

function facts(name: string): ArchiveFacts {
  return {
    sha256: "a".repeat(64),
    size: 2048,
    filename: `${name.toLowerCase()}.sd7`,
    kind: "map",
    internal_name: name,
    version: "",
    shortname: null,
    author: null,
    description: null,
  };
}

beforeEach(() => {
  signedIn = true;
  run = null;
  find.mockReset();
  upload.mockReset();
  stop.mockReset();
});

afterEach(cleanup);

it("offers nothing until somebody is signed in", () => {
  signedIn = false;
  const { container } = render(
    <MapArchivesControl hubUrl="https://hub.test" />,
  );
  expect(container.innerHTML).toBe("");
});

it("lists the maps found and uploads only the ones still ticked", async () => {
  find.mockResolvedValue({
    candidates: ["Tabula", "Comet"].map((name) => ({
      mapName: name,
      facts: facts(name),
      path: `/maps/${name}.sd7`,
    })),
    skipped: [{ mapName: "Folder", reason: "It is an unpacked folder." }],
    listed: 4,
  });
  render(<MapArchivesControl hubUrl="https://hub.test" />);
  fireEvent.click(
    screen.getByRole("button", { name: "Find maps the hub is missing" }),
  );
  await screen.findByText("Tabula");
  expect(screen.getByText("It is an unpacked folder.")).toBeTruthy();

  fireEvent.click(screen.getByRole("checkbox", { name: /Comet/ }));
  fireEvent.click(screen.getByRole("button", { name: /Upload 1 map/ }));
  expect(upload).toHaveBeenCalledOnce();
  expect(upload.mock.calls[0][0]).toBe("https://hub.test");
  expect(
    upload.mock.calls[0][1].map((one: { mapName: string }) => one.mapName),
  ).toEqual(["Tabula"]);
});

it("shows a run in progress, and stops it on Stop", () => {
  run = {
    hubUrl: "https://hub.test",
    running: true,
    items: [
      { mapName: "Tabula", filename: "t.sd7", size: 1, status: "listed" },
      {
        mapName: "Comet",
        filename: "c.sd7",
        size: 1,
        status: "failed",
        said: "No mirror took it.",
      },
      { mapName: "Dune", filename: "d.sd7", size: 1, status: "sending" },
    ],
  };
  render(<MapArchivesControl hubUrl="https://hub.test" />);
  expect(screen.getByText("2 of 3 done")).toBeTruthy();
  expect(screen.getByText(/No mirror took it\./)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(stop).toHaveBeenCalledOnce();
});
