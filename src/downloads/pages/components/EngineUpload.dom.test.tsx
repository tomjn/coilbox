// @vitest-environment happy-dom

/**
 * "Upload a test build": a build an official Recoil release already has is
 * refused before the hub is asked, and one it does not have is sent with its
 * note under an engine grant.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngineUpload } from "./EngineUpload";

const FACTS = {
  sha256: "a".repeat(64),
  size: 2048,
  filename: "recoil_2026.09.03_arm64-macos.7z",
  kind: "engine" as const,
  internal_name: "recoil" as const,
  version: "2026.09.03",
  platform: "arm64-macos",
};

const mocks = vi.hoisted(() => ({
  official: [] as { version: string; platform: string }[],
  officialFails: false,
  start: vi.fn(),
  begin: vi.fn(async () => "grant-1"),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: async () => "/builds/recoil_2026.09.03_arm64-macos.7z",
}));
vi.mock("../../bindings", () => ({
  dlEngineUploadFacts: async () => ({ facts: FACTS }),
}));
vi.mock("../../engineLists", () => ({
  loadOfficialBuilds: async () => {
    if (mocks.officialFails) throw new Error("GitHub is limiting requests.");
    return { builds: mocks.official };
  },
}));
vi.mock("../../../hub/manualSend/grant", () => ({
  beginEngineSend: mocks.begin,
  endManualSend: async () => {},
}));
vi.mock("../../../hub/archiveUploads", () => ({
  startArchiveUpload: mocks.start,
  listArchiveUploads: async () => [],
  onArchiveUploadChanged: async () => () => {},
  cancelArchiveUpload: async () => {},
}));

beforeEach(() => {
  mocks.official = [];
  mocks.officialFails = false;
  mocks.start.mockReset();
  mocks.start.mockImplementation(async () => ({
    opId: "op",
    hubUrl: "https://hub.example",
    filename: FACTS.filename,
    kind: "engine",
    sha256: FACTS.sha256,
    phase: "reserving",
    sent: 0,
    size: FACTS.size,
    uploadId: null,
    outcome: null,
  }));
});
afterEach(cleanup);

const pick = () => {
  render(<EngineUpload hubUrl="https://hub.example" onListed={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Upload a test build" }));
};

describe("EngineUpload", () => {
  it("refuses a build an official release already has", async () => {
    mocks.official = [{ version: "2026.09.03", platform: "arm64-macos" }];
    pick();
    await screen.findByText(/official Recoil release already has/);
    expect(screen.queryByLabelText("Note")).toBeNull();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("refuses when the official releases cannot be checked", async () => {
    mocks.officialFails = true;
    pick();
    await screen.findByText(/could not check the official Recoil releases/);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("sends the facts and the note under an engine grant", async () => {
    pick();
    const note = await screen.findByLabelText("Note");
    const upload = screen.getByRole("button", { name: "Upload" });
    expect((upload as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(note, { target: { value: "  Apple silicon build.  " } });
    fireEvent.click(upload);
    await waitFor(() => expect(mocks.start).toHaveBeenCalled());
    expect(mocks.begin).toHaveBeenCalledWith(FACTS.filename);
    expect(mocks.start).toHaveBeenCalledWith(
      "https://hub.example",
      "/builds/recoil_2026.09.03_arm64-macos.7z",
      {
        ...FACTS,
        shortname: null,
        author: null,
        description: null,
        note: "Apple silicon build.",
      },
      "grant-1",
    );
  });
});
