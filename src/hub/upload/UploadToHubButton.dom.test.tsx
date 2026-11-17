// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HubAccount } from "../account";
import type { ArchiveFacts, ArchiveUploadState } from "../archiveUploads";

const readFacts = vi.fn();
vi.mock("@/content/bindings", () => ({
  unitsyncUploadFacts: (...args: unknown[]) => readFacts(...args),
}));

const started = vi.fn();
vi.mock("../archiveUploads", () => ({
  startArchiveUpload: (...args: unknown[]) => started(...args),
  listArchiveUploads: async () => [],
  onArchiveUploadChanged: async () => () => {},
  cancelArchiveUpload: async () => {},
}));

const begun = vi.fn(async (_subject: unknown) => "grant-1");
const ended = vi.fn(async (_grant: string) => {});
vi.mock("../manualSend/grant", () => ({
  beginManualSend: (subject: unknown) => begun(subject),
  endManualSend: (grant: string) => ended(grant),
}));

const sentFirst = vi.fn();
vi.mock("../manualSend/run", () => ({
  noteHubChanged: () => {},
  startManualSend: (...args: unknown[]) => sentFirst(...args),
}));
vi.mock("../manualSend/status", () => ({
  gamePageUrl: (hub: string, shortname: string) => `${hub}/games/${shortname}`,
  mapPageUrl: (hub: string, slug: string) => `${hub}/map/${slug}`,
}));
vi.mock("../maps/lookup", () => ({
  fetchMapFacts: async () => ({ ok: false }),
}));

const notified = vi.fn();
vi.mock("@/notify/notify", () => ({
  notify: (input: unknown) => notified(input),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));
vi.mock("../config", () => ({ useHubUrl: () => "https://hub.test" }));

let account: HubAccount;
vi.mock("../account", () => ({ useHubAccount: () => account }));
vi.mock("../pages/components/AccountControl", () => ({
  SignInButton: () => <button type="button">Sign in with Discord</button>,
}));

import { forgetArchiveUploads, rememberUpload } from "./store";
import { UploadToHubButton } from "./UploadToHubButton";

function signedIn(): HubAccount {
  return {
    loading: false,
    busy: false,
    signedIn: true,
    unknown: false,
    account: null,
    problem: null,
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    recheck: vi.fn(async () => {}),
  };
}

const SHA = "a".repeat(64);
const FACTS: ArchiveFacts = {
  sha256: SHA,
  size: 3_873_899,
  filename: "tabula_3.sd7",
  kind: "map",
  internal_name: "Tabula 3",
  version: "1.0",
  shortname: null,
  author: null,
  description: null,
};

function state(patch: Partial<ArchiveUploadState> = {}): ArchiveUploadState {
  return {
    opId: "op-1",
    hubUrl: "https://hub.test",
    filename: "tabula_3.sd7",
    kind: "map",
    sha256: SHA,
    phase: "sending",
    sent: 0,
    size: FACTS.size,
    uploadId: "up-1",
    outcome: null,
    ...patch,
  };
}

const MAP = {
  target: { kind: "map", mapName: "Tabula 3" } as const,
  label: "Tabula 3",
  enginePath: "/e",
  dataDir: "/d",
  archivePath: "/d/maps/tabula_3.sd7",
  fileName: "tabula_3.sd7",
  hub: { presence: { state: "unknown" }, hashes: new Set<string>() } as const,
  pageUrl: null,
};

beforeEach(() => {
  account = signedIn();
  readFacts.mockReset();
  readFacts.mockResolvedValue({ facts: FACTS, errors: [] });
  started.mockReset();
  started.mockResolvedValue(state({ phase: "reserving" }));
  begun.mockClear();
  ended.mockClear();
  notified.mockClear();
  forgetArchiveUploads();
});

afterEach(() => cleanup());

describe("the upload to hub button", () => {
  it("shows nothing until the hub has said what it holds", () => {
    const { container } = render(
      <UploadToHubButton
        {...MAP}
        hub={{ presence: { state: "unknown" }, hashes: undefined }}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows nothing without the archive's file", () => {
    const { container } = render(
      <UploadToHubButton {...MAP} archivePath={undefined} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("reads nothing until the panel is opened when the hub lists no archive", () => {
    render(<UploadToHubButton {...MAP} />);
    expect(screen.getByRole("button", { name: /Upload to hub/ })).toBeTruthy();
    expect(readFacts).not.toHaveBeenCalled();
  });

  it("goes once the hub lists an archive with this one's hash", async () => {
    const { container } = render(
      <UploadToHubButton
        {...MAP}
        hub={{ presence: { state: "unknown" }, hashes: new Set([SHA]) }}
      />,
    );
    await waitFor(() => expect(container.innerHTML).toBe(""));
    expect(readFacts).toHaveBeenCalledWith({
      enginePath: "/e",
      dataDir: "/d",
      map: "Tabula 3",
      game: undefined,
    });
  });

  it("stays when the hub lists a different archive of the same name", async () => {
    render(
      <UploadToHubButton
        {...MAP}
        hub={{
          presence: { state: "unknown" },
          hashes: new Set(["b".repeat(64)]),
        }}
      />,
    );
    await waitFor(() => expect(readFacts).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /Upload to hub/ })).toBeTruthy();
  });

  it("asks before the first byte goes, saying the file will be public", async () => {
    render(<UploadToHubButton {...MAP} />);
    fireEvent.click(screen.getByRole("button", { name: /Upload to hub/ }));
    expect(await screen.findByText(/will be public/)).toBeTruthy();
    expect(screen.getByText(/tabula_3\.sd7/)).toBeTruthy();
    expect(screen.getByText(/keeps the name of your account/)).toBeTruthy();
    expect(started).not.toHaveBeenCalled();
  });

  it("offers the sign in first to somebody signed out", async () => {
    account = { ...signedIn(), signedIn: false };
    render(<UploadToHubButton {...MAP} />);
    fireEvent.click(screen.getByRole("button", { name: /Upload to hub/ }));
    expect(
      await screen.findByRole("button", { name: "Sign in with Discord" }),
    ).toBeTruthy();
    expect(screen.queryByText(/will be public/)).toBeNull();
  });

  it("starts the upload under a grant for this map, then closes the grant", async () => {
    render(<UploadToHubButton {...MAP} />);
    fireEvent.click(screen.getByRole("button", { name: /Upload to hub/ }));
    await screen.findByText(/will be public/);
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(started).toHaveBeenCalled());
    expect(begun).toHaveBeenCalledWith({ kind: "map", map_name: "Tabula 3" });
    expect(started).toHaveBeenCalledWith(
      "https://hub.test",
      "/d/maps/tabula_3.sd7",
      FACTS,
      "grant-1",
    );
    await waitFor(() => expect(ended).toHaveBeenCalledWith("grant-1"));
    // The page shows the upload that is running rather than offering another.
    expect(
      (await screen.findByRole("button", { name: /Uploading/ })).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
  });

  it("says so when the upload could not start", async () => {
    started.mockRejectedValue(new Error("no permission"));
    render(<UploadToHubButton {...MAP} />);
    fireEvent.click(screen.getByRole("button", { name: /Upload to hub/ }));
    await screen.findByText(/will be public/);
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(notified).toHaveBeenCalled());
    expect(notified.mock.calls[0][0]).toMatchObject({
      title: "Tabula 3 was not uploaded",
      level: "error",
    });
    expect(ended).toHaveBeenCalledWith("grant-1");
  });

  it("keeps the button disabled for an upload that is running when the page opens", () => {
    rememberUpload(state(), { kind: "map", label: "Tabula 3" });
    render(<UploadToHubButton {...MAP} />);
    expect(
      screen
        .getByRole("button", { name: /Uploading/ })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("says plainly that a game installed through rapid cannot go to the hub", async () => {
    render(
      <UploadToHubButton
        {...MAP}
        target={{ kind: "game", archiveName: "0123abcd.sdp" }}
        label="Beyond All Reason"
        archivePath="/d/packages/0123abcd.sdp"
        fileName="0123abcd.sdp"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Upload to hub/ }));
    expect(await screen.findByText(/installed through rapid/)).toBeTruthy();
    expect(screen.getByText(/one \.sd7 or \.sdz file/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(readFacts).not.toHaveBeenCalled();
  });

  it("says plainly that an unpacked game folder cannot go to the hub", async () => {
    render(
      <UploadToHubButton
        {...MAP}
        target={{ kind: "game", archiveName: "mygame.sdd" }}
        label="My game"
        archivePath="/d/games/mygame.sdd"
        fileName="mygame.sdd"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Upload to hub/ }));
    expect(await screen.findByText(/unpacked folder/)).toBeTruthy();
    expect(readFacts).not.toHaveBeenCalled();
  });

  it("gives the reason the facts reader refused, as it said it", async () => {
    readFacts.mockResolvedValue({
      problem: "This game's modinfo.lua has no shortname.",
      errors: [],
    });
    render(
      <UploadToHubButton
        {...MAP}
        target={{ kind: "game", archiveName: "sf.sdz" }}
        label="Splinter Faction"
        archivePath="/d/games/sf.sdz"
        fileName="sf.sdz"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Upload to hub/ }));
    expect(
      await screen.findByText("This game's modinfo.lua has no shortname."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
  });

  it("reports a duplicate with the existing page, once the upload ends", async () => {
    rememberUpload(state(), { kind: "map", label: "Tabula 3" });
    const { rerender } = render(<UploadToHubButton {...MAP} />);
    await act(async () => {
      rememberUpload(
        state({
          phase: "done",
          outcome: {
            kind: "stopped",
            source: "hub",
            code: "duplicate",
            status: 409,
            said: "duplicate",
            duplicate: {
              check: "sha256",
              filename: "tabula_3.sd7",
              kind: "map",
              state: "listed",
              url: "https://hub.test/map/tabula-3",
            },
          },
        }),
        { kind: "map", label: "Tabula 3" },
      );
    });
    rerender(<UploadToHubButton {...MAP} />);
    fireEvent.click(screen.getByRole("button", { name: /Upload to hub/ }));
    expect(
      await screen.findByText("The hub already has Tabula 3"),
    ).toBeTruthy();
    expect(screen.getByText(/exactly the same contents/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show on hub" })).toBeTruthy();
    expect(notified).toHaveBeenCalledOnce();
  });

  it("offers the send step first when the hub does not know the game", async () => {
    const game = {
      ...MAP,
      target: { kind: "game", archiveName: "sf.sdz" } as const,
      label: "Splinter Faction",
      archivePath: "/d/games/sf.sdz",
      fileName: "sf.sdz",
      sendSubject: { kind: "game", shortname: "SF" } as const,
    };
    const facts = { ...FACTS, kind: "game" as const, filename: "sf.sdz" };
    readFacts.mockResolvedValue({ facts, errors: [] });
    rememberUpload(state({ kind: "game", filename: "sf.sdz" }), {
      kind: "game",
      label: "Splinter Faction",
    });
    render(<UploadToHubButton {...game} />);
    await act(async () => {
      rememberUpload(
        state({
          kind: "game",
          filename: "sf.sdz",
          phase: "done",
          outcome: {
            kind: "stopped",
            source: "hub",
            code: "unknown_game",
            status: 422,
            said: "unknown",
          },
        }),
        { kind: "game", label: "Splinter Faction" },
      );
    });
    fireEvent.click(screen.getByRole("button", { name: /Upload to hub/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Send to hub" }));
    expect(sentFirst).toHaveBeenCalledWith({
      hubUrl: "https://hub.test",
      enginePath: "/e",
      dataDir: "/d",
      subject: { kind: "game", shortname: "SF" },
      label: "Splinter Faction",
    });
  });

  it("offers another try after a file that changed, and asks again", async () => {
    rememberUpload(state(), { kind: "map", label: "Tabula 3" });
    render(<UploadToHubButton {...MAP} />);
    await act(async () => {
      rememberUpload(
        state({
          phase: "done",
          outcome: {
            kind: "stopped",
            source: "local",
            code: "file_changed",
            status: null,
            said: "changed",
          },
        }),
        { kind: "map", label: "Tabula 3" },
      );
    });
    fireEvent.click(screen.getByRole("button", { name: /Upload to hub/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Upload again" }),
    );
    expect(await screen.findByText(/will be public/)).toBeTruthy();
    // The file is read again, because it is not the file that was read before.
    await waitFor(() => expect(readFacts).toHaveBeenCalledTimes(2));
  });
});
