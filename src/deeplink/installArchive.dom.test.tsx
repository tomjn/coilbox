// @vitest-environment happy-dom

/**
 * A game or map archive handed to coilbox as a file, through the deep-link
 * handler's prompt.
 *
 * The three ways in are a `file://` URL (macOS open with), the `open-archive`
 * event and the `launch_archives` command (Windows and Linux open with), and a
 * drop on the window. Each is fed in by hand here. The Rust commands, the
 * content folders and the list refresh are stood in for, so nothing is read
 * from or written to a disk.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClaimFileDrop } from "@/lib/fileDropClaim";
import { resetInviteStore } from "../multiplayer/invite/inviteStore";
import { dispatchDeepLink } from "./bus";
import { DeepLinkHandler } from "./DeepLinkHandler";

vi.mock("@tauri-apps/plugin-deep-link", () => ({
  getCurrent: async () => null,
  onOpenUrl: async () => () => {},
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: async () => {},
}));

type DropEvent = {
  payload:
    | { type: "enter"; paths: string[] }
    | { type: "drop"; paths: string[] }
    | { type: "leave" };
};
let onDrop: ((event: DropEvent) => void) | null = null;
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: (event: DropEvent) => void) => {
      onDrop = handler;
      return () => {};
    },
  }),
}));

let onOpenArchive: ((event: { payload: string[] }) => void) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    _name: string,
    handler: (event: { payload: string[] }) => void,
  ) => {
    onOpenArchive = handler;
    return () => {};
  },
}));

let launchArchives: string[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (command: string) =>
    command === "launch_archives" ? launchArchives : undefined,
}));

const notify = vi.fn();
vi.mock("../notify/notify", () => ({
  notify: (input: unknown) => notify(input),
}));

vi.mock("../hub/config", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../hub/config")),
  useTrustedHubUrl: () => "https://hub.example",
}));

let roots = {
  games: { path: "/spring" as string | undefined, loading: false },
  maps: { path: "/spring" as string | undefined, loading: false },
};
vi.mock("../downloads/config", () => ({
  useWriteRoot: (kind: "games" | "maps") => roots[kind],
}));

const invalidateScans = vi.fn();
vi.mock("../content/config", () => ({
  invalidateScans: () => invalidateScans(),
}));

type Args = { path: string; gamesRoot?: string; mapsRoot?: string };
const inspect = vi.fn(async ({ path }: Args) => {
  const fileName = path.split("/").pop() ?? path;
  if (fileName === "notes.sdz") {
    throw new Error("notes.sdz is neither a game nor a map.");
  }
  if (fileName === "have.sdz") {
    throw new Error(
      "have.sdz is already in /spring/games. Nothing was copied.",
    );
  }
  return fileName.endsWith(".sd7")
    ? { kind: "map" as const, fileName, destDir: "/spring/maps" }
    : { kind: "game" as const, fileName, destDir: "/spring/games" };
});
const install = vi.fn(async (_args: Args) => ({}));
vi.mock("../downloads/bindings", () => ({
  dlInspectArchive: (args: Args) => inspect(args),
  dlInstallArchive: (args: Args) => install(args),
}));

const GAME = "/Users/me/Downloads/SplinterFaction_0.1.89.sdz";
const GAME_URL = "file:///Users/me/Downloads/SplinterFaction_0.1.89.sdz";

function ClaimingPage() {
  useClaimFileDrop();
  return <p>a page that takes drops</p>;
}

async function draw(page: React.ReactNode = <p>app</p>) {
  const view = render(
    <MemoryRouter initialEntries={["/home"]}>
      <DeepLinkHandler>{page}</DeepLinkHandler>
    </MemoryRouter>,
  );
  // The listeners are subscribed a tick after the first render.
  await waitFor(() => expect(onDrop).not.toBeNull());
  await waitFor(() => expect(onOpenArchive).not.toBeNull());
  return view;
}

const drop = (event: DropEvent["payload"]) =>
  act(() => onDrop?.({ payload: event } as DropEvent));

const press = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  onDrop = null;
  onOpenArchive = null;
  launchArchives = [];
  roots = {
    games: { path: "/spring", loading: false },
    maps: { path: "/spring", loading: false },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetInviteStore();
});

describe("a file opened with coilbox", () => {
  it("is asked about, then copied, then the lists are refreshed", async () => {
    await draw();
    act(() => dispatchDeepLink(GAME_URL));

    await screen.findByText("Install the game SplinterFaction_0.1.89.sdz?");
    screen.getByText(
      "It is copied to /spring/games. The file you opened stays where it is.",
    );
    expect(install).not.toHaveBeenCalled();

    press("Install");
    await waitFor(() =>
      expect(install).toHaveBeenCalledWith({
        path: GAME,
        gamesRoot: "/spring",
        mapsRoot: "/spring",
      }),
    );
    await waitFor(() => expect(invalidateScans).toHaveBeenCalledTimes(1));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Installed SplinterFaction_0.1.89.sdz",
        level: "success",
      }),
    );
  });

  it("says what it is copying, and takes no other file, until the copy ends", async () => {
    let finish: () => void = () => {};
    install.mockImplementationOnce(
      () => new Promise((resolve) => (finish = () => resolve({}))),
    );
    await draw();
    act(() => dispatchDeepLink(GAME_URL));
    await screen.findByText("Install the game SplinterFaction_0.1.89.sdz?");
    press("Install");
    await screen.findByText("Copying SplinterFaction_0.1.89.sdz.");

    act(() => dispatchDeepLink("file:///Users/me/comet.sd7"));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Ignored a file" }),
    );
    expect(inspect).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    await waitFor(() =>
      expect(
        screen.queryByText("Copying SplinterFaction_0.1.89.sdz."),
      ).toBeNull(),
    );
  });

  it("copies nothing when the prompt is cancelled", async () => {
    await draw();
    act(() => dispatchDeepLink(GAME_URL));
    await screen.findByText("Install the game SplinterFaction_0.1.89.sdz?");
    press("Cancel");
    expect(install).not.toHaveBeenCalled();
    expect(invalidateScans).not.toHaveBeenCalled();
  });

  it("is refused with the reason when it is neither a game nor a map", async () => {
    await draw();
    act(() => dispatchDeepLink("file:///Users/me/notes.sdz"));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith({
        title: "Nothing was installed",
        body: "notes.sdz is neither a game nor a map.",
        level: "error",
      }),
    );
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("is refused when its name is already in the folder", async () => {
    await draw();
    act(() => dispatchDeepLink("file:///Users/me/have.sdz"));
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          body: "have.sdz is already in /spring/games. Nothing was copied.",
        }),
      ),
    );
    expect(install).not.toHaveBeenCalled();
  });

  it("waits for the content folders before it reads the file", async () => {
    roots.games = { path: undefined, loading: true };
    const view = await draw();
    act(() => dispatchDeepLink(GAME_URL));
    await act(async () => {});
    expect(inspect).not.toHaveBeenCalled();

    roots = { ...roots, games: { path: "/late", loading: false } };
    view.rerender(
      <MemoryRouter initialEntries={["/home"]}>
        <DeepLinkHandler>
          <p>app</p>
        </DeepLinkHandler>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(inspect).toHaveBeenCalledWith({
        path: GAME,
        gamesRoot: "/late",
        mapsRoot: "/spring",
      }),
    );
  });

  it("is refused while another prompt is open, and that prompt stays", async () => {
    await draw();
    act(() =>
      dispatchDeepLink("coilbox://room?address=192.168.1.45&port=8200"),
    );
    screen.getByText("Join the room at 192.168.1.45:8200?");

    act(() => dispatchDeepLink(GAME_URL));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Ignored a file", level: "error" }),
    );
    expect(inspect).not.toHaveBeenCalled();
    screen.getByText("Join the room at 192.168.1.45:8200?");
  });

  it("holds off a link that arrives while it is being asked about", async () => {
    await draw();
    act(() => dispatchDeepLink(GAME_URL));
    await screen.findByText("Install the game SplinterFaction_0.1.89.sdz?");

    act(() =>
      dispatchDeepLink("coilbox://room?address=192.168.1.45&port=8200"),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Ignored a coilbox link" }),
    );
    screen.getByText("Install the game SplinterFaction_0.1.89.sdz?");
  });
});

describe("a file from a Windows or Linux launch", () => {
  it("is offered when the app was started with it", async () => {
    launchArchives = [GAME];
    await draw();
    await screen.findByText("Install the game SplinterFaction_0.1.89.sdz?");
  });

  it("is offered when a second launch passes it on", async () => {
    await draw();
    act(() => onOpenArchive?.({ payload: ["/home/me/comet.sd7"] }));
    await screen.findByText("Install the map comet.sd7?");
  });
});

describe("a file dropped on the window", () => {
  it("asks about several at once and lists what it refused", async () => {
    await draw();
    drop({ type: "drop", paths: [GAME, "/dl/comet.sd7", "/dl/notes.sdz"] });

    await screen.findByText(
      "SplinterFaction_0.1.89.sdz, a game, is copied to /spring/games.",
    );
    screen.getByText("comet.sd7, a map, is copied to /spring/maps.");
    screen.getByText("notes.sdz is neither a game nor a map.");

    press("Install");
    await waitFor(() => expect(install).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(invalidateScans).toHaveBeenCalledTimes(1));
  });

  it("shows where to drop only while an archive is over the window", async () => {
    await draw();
    drop({ type: "enter", paths: ["/dl/picture.png"] });
    expect(screen.queryByText("Drop to install")).toBeNull();

    drop({ type: "enter", paths: [GAME] });
    screen.getByText("Drop to install");

    drop({ type: "leave" });
    expect(screen.queryByText("Drop to install")).toBeNull();
  });

  it("is left alone on a page that takes dropped files itself", async () => {
    await draw(<ClaimingPage />);
    drop({ type: "enter", paths: [GAME] });
    expect(screen.queryByText("Drop to install")).toBeNull();

    drop({ type: "drop", paths: [GAME] });
    await act(async () => {});
    expect(inspect).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("is taken again once that page is gone", async () => {
    const view = await draw(<ClaimingPage />);
    view.rerender(
      <MemoryRouter initialEntries={["/home"]}>
        <DeepLinkHandler>
          <p>app</p>
        </DeepLinkHandler>
      </MemoryRouter>,
    );
    drop({ type: "drop", paths: [GAME] });
    await screen.findByText("Install the game SplinterFaction_0.1.89.sdz?");
  });
});
