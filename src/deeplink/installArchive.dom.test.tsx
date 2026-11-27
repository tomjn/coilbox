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
let archiveSettings = { move: false, noPrompt: false };
const setMove = vi.fn();
const setNoPrompt = vi.fn();
vi.mock("../downloads/config", () => ({
  useWriteRoot: (kind?: "games" | "maps") => roots[kind ?? "games"],
  useArchiveInstallSettings: () => ({
    ...archiveSettings,
    setMove,
    setNoPrompt,
  }),
}));

const invalidateScans = vi.fn();
let replaysRoot: string | undefined = "/spring";
vi.mock("../content/config", () => ({
  invalidateScans: () => invalidateScans(),
  useScanTargetSelection: () => ({
    selected: replaysRoot ? { rootPath: replaysRoot } : null,
  }),
}));

type ReplayArgs = { path: string; root: string };
const inspectReplay = vi.fn(async ({ path, root }: ReplayArgs) => {
  const fileName = path.split("/").pop() ?? path;
  if (fileName === "broken.sdfz") {
    throw new Error("broken.sdfz is not a replay coilbox can read: no header.");
  }
  return {
    offer: {
      fileName,
      destDir: `${root}/demos`,
      mapName: "Comet Catcher Redux",
      gameType: "Beyond All Reason",
      ...(fileName === "held.sdfz" && { inLibrary: "2026-11-01_mine.sdfz" }),
    },
  };
});
const addReplay = vi.fn(async (_args: ReplayArgs) => ({ path: "" }));
vi.mock("../content/bindings", () => ({
  contentInspectReplayFile: (args: ReplayArgs) => inspectReplay(args),
  contentAddReplayFile: (args: ReplayArgs) => addReplay(args),
}));

const loadReplays = vi.fn(async (_root: string, _refresh?: boolean) => []);
vi.mock("../content/replayList", () => ({
  loadReplays: (root: string, refresh?: boolean) => loadReplays(root, refresh),
}));

type Args = {
  path: string;
  gamesRoot?: string;
  mapsRoot?: string;
  moveOriginal?: boolean;
};
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
const install = vi.fn(
  async (_args: Args): Promise<{ moveError?: string }> => ({}),
);
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
  replaysRoot = "/spring";
  archiveSettings = { move: false, noPrompt: false };
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
    screen.getByText("It goes in /spring/games.");
    expect(install).not.toHaveBeenCalled();

    press("Install");
    await waitFor(() =>
      expect(install).toHaveBeenCalledWith({
        path: GAME,
        gamesRoot: "/spring",
        mapsRoot: "/spring",
        moveOriginal: false,
      }),
    );
    expect(setNoPrompt).not.toHaveBeenCalled();
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

describe("the prompt's choices", () => {
  it("deletes the original when that box is ticked", async () => {
    await draw();
    act(() => dispatchDeepLink(GAME_URL));
    await screen.findByText("Install the game SplinterFaction_0.1.89.sdz?");

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Delete the original after installing",
      }),
    );
    press("Install");
    await waitFor(() =>
      expect(install).toHaveBeenCalledWith(
        expect.objectContaining({ path: GAME, moveOriginal: true }),
      ),
    );
    // Asking again next time means this answer is not kept.
    expect(setMove).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ body: "Moved to /spring/games." }),
      ),
    );
  });

  it("keeps both answers when told not to ask again", async () => {
    await draw();
    act(() => dispatchDeepLink(GAME_URL));
    await screen.findByText("Install the game SplinterFaction_0.1.89.sdz?");

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Delete the original after installing",
      }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Do not ask again" }));
    press("Install");
    await waitFor(() => expect(install).toHaveBeenCalledTimes(1));
    expect(setMove).toHaveBeenCalledWith(true);
    expect(setNoPrompt).toHaveBeenCalledWith(true);
  });

  it("installs without asking once that is the setting", async () => {
    archiveSettings = { move: true, noPrompt: true };
    await draw();
    act(() => dispatchDeepLink(GAME_URL));

    await waitFor(() =>
      expect(install).toHaveBeenCalledWith(
        expect.objectContaining({ path: GAME, moveOriginal: true }),
      ),
    );
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("says so when the original could not be deleted", async () => {
    archiveSettings = { move: true, noPrompt: true };
    install.mockResolvedValueOnce({ moveError: "It is read-only." });
    await draw();
    act(() => dispatchDeepLink(GAME_URL));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Could not delete an original",
          body: "It is read-only.",
          level: "warning",
        }),
      ),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ body: "Copied to /spring/games." }),
    );
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
      "SplinterFaction_0.1.89.sdz, a game, goes in /spring/games.",
    );
    screen.getByText("comet.sd7, a map, goes in /spring/maps.");
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

describe("a replay dropped on the window", () => {
  const REPLAY = "/Users/me/Downloads/match.sdfz";

  it("is asked about, then copied into the library, which is read again", async () => {
    await draw();
    drop({ type: "drop", paths: [REPLAY] });

    await screen.findByText(
      "Add the replay of Beyond All Reason on Comet Catcher Redux to your replay library?",
    );
    screen.getByText("A copy goes in /spring/demos.");
    expect(addReplay).not.toHaveBeenCalled();

    press("Add to library");
    await waitFor(() =>
      expect(addReplay).toHaveBeenCalledWith({ path: REPLAY, root: "/spring" }),
    );
    await waitFor(() =>
      expect(loadReplays).toHaveBeenCalledWith("/spring", true),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Added a replay to your library",
        level: "success",
        to: "/play/replays/match.sdfz",
      }),
    );
    expect(inspect).not.toHaveBeenCalled();
  });

  it("copies nothing when the prompt is cancelled", async () => {
    await draw();
    drop({ type: "drop", paths: [REPLAY] });
    await screen.findByText("A copy goes in /spring/demos.");
    press("Cancel");
    await act(async () => {});
    expect(addReplay).not.toHaveBeenCalled();
  });

  it("offers to open the library's copy of a match it already has", async () => {
    await draw();
    drop({ type: "drop", paths: ["/dl/held.sdfz"] });
    await screen.findByText(
      "held.sdfz is a match already in your replay library, as 2026-11-01_mine.sdfz.",
    );
    press("Open it");
    await act(async () => {});
    expect(addReplay).not.toHaveBeenCalled();
  });

  it("is refused with the reason when it cannot be read", async () => {
    await draw();
    drop({ type: "drop", paths: ["/dl/broken.sdfz"] });
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Nothing was added",
          body: "broken.sdfz is not a replay coilbox can read: no header.",
          level: "error",
        }),
      ),
    );
  });

  it("is asked about after the archives dropped with it", async () => {
    await draw();
    drop({ type: "drop", paths: [GAME, REPLAY] });

    await screen.findByText("Install the game SplinterFaction_0.1.89.sdz?");
    expect(inspectReplay).not.toHaveBeenCalled();
    press("Install");

    await screen.findByText("A copy goes in /spring/demos.");
    expect(install).toHaveBeenCalledTimes(1);
    press("Add to library");
    await waitFor(() => expect(addReplay).toHaveBeenCalledTimes(1));
  });

  it("goes in the folder of the engine the library lists", async () => {
    replaysRoot = "/elsewhere";
    await draw();
    drop({ type: "drop", paths: [REPLAY] });
    await screen.findByText("A copy goes in /elsewhere/demos.");
  });

  it("shows where to drop while a replay is over the window", async () => {
    await draw();
    drop({ type: "enter", paths: [REPLAY] });
    screen.getByText("Drop to add to your replays");
    drop({ type: "leave" });
    expect(screen.queryByText("Drop to add to your replays")).toBeNull();
  });
});
