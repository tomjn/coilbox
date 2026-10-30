// @vitest-environment happy-dom

/**
 * Hosting a battle on a game's compat mutator (issue #4712). The switch offers
 * it beside the game itself, the host sees the compat version, and a mutator that
 * is missing or stale holds Host back until it is built. A game whose switch is
 * off offers only the game, and nothing about its mutator is read.
 *
 * `useHostContent` is stood in as in `hostBattleWhyNot.dom.test.tsx`.
 */

import { DrawerProvider, PersistentStoreProvider } from "@picoframe/frame";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const build = vi.hoisted(() => vi.fn());
const status = vi.hoisted(() => vi.fn());
const info = vi.hoisted(() => vi.fn());
const invalidate = vi.hoisted(() => vi.fn());
const scan = vi.hoisted(() => vi.fn());
const settings = vi.hoisted(() => ({
  current: {} as Record<string, { enabled: boolean; version: number }>,
}));
const content = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  Channel: class {},
}));
vi.mock("../../compat/bindings", () => ({
  compatBuild: (args: unknown) => build(args),
  compatStatus: (args: unknown) => status(args),
}));
vi.mock("@/content/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/content/config")>()),
  primeGameInfo: (...args: unknown[]) => info(...args),
  primeScan: (...args: unknown[]) => scan(...args),
  invalidateGameInfo: (...args: unknown[]) => invalidate(...args),
  useUnitsyncGameHeaders: () => ({ headers: new Map() }),
  useUnitsyncThumbnails: () => ({ thumbs: new Map() }),
}));
vi.mock("../../content/compatSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../content/compatSettings")>()),
  useCompatSettings: () => [settings.current, vi.fn()],
}));
vi.mock("./useHostContent", () => ({
  useHostContent: () => content.current,
  hashFailureMessage: () => "could not hash",
}));
vi.mock("./hostEngineVersion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hostEngineVersion")>()),
  hostEngineVersion: async () => "105.1.1",
}));
vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({ value }: { value: string }) => <span>{value}</span>,
}));
vi.mock("../../direct/ReachablePorts", () => ({ ReachablePorts: () => null }));
vi.mock("../../direct/bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../direct/bindings")>()),
  directVpnRoute: vi.fn(async () => ({ vpn: null })),
}));
vi.mock("../../direct/reachability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../direct/reachability")>()),
  directClosePorts: vi.fn(async () => ({ closed: true })),
}));

const { HostBattleForm } = await import("./HostBattleForm");
const { HostRoomForm } = await import("../../direct/HostRoomForm");

const XTA = { name: "XTA 9.65", primaryArchive: { name: "xta-9.65.sd7" } };
const MUTATOR = {
  name: "XTA 9.65 (compat 24)",
  primaryArchive: { name: "coilbox-compat-xta-9.65-24.sdd" },
};
const ON = { "xta-9.65.sd7": { enabled: true, version: 24 } };
const BUILT = { latest: 24, folder: MUTATOR.primaryArchive.name, stale: [] };

function form() {
  const onHost = vi.fn(async () => {});
  render(
    <PersistentStoreProvider>
      <DrawerProvider>
        <HostBattleForm relayAvailable={false} onHost={onHost} />
      </DrawerProvider>
    </PersistentStoreProvider>,
  );
  return onHost;
}

const hostButton = () =>
  screen.getByRole("button", { name: /Host battle/ }) as HTMLButtonElement;

const submit = () =>
  fireEvent.submit(hostButton().closest("form") as HTMLFormElement);

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
  settings.current = ON;
  build.mockReset().mockResolvedValue({});
  status.mockReset().mockResolvedValue(BUILT);
  info.mockReset().mockImplementation(async (_e, _d, archive: string) => ({
    checksum: archive === MUTATOR.primaryArchive.name ? "00000010" : "abc",
  }));
  invalidate.mockReset();
  scan.mockReset().mockResolvedValue({ games: [XTA, MUTATOR] });
  content.current = {
    targets: [],
    target: {
      engineVersion: "105.1.1",
      syncVersion: "105.1.1",
      enginePath: "/e",
      dataDir: "/d",
    },
    games: [XTA],
    maps: [{ name: "Comet Catcher Redux" }],
    scanning: false,
    noEngine: false,
    gameName: XTA.name,
    selectedGame: XTA,
    setGameName: vi.fn(),
    mapName: "Comet Catcher Redux",
    setMapName: vi.fn(),
    gameInfo: { status: "ready", info: { checksum: "abc" } },
    mapInfo: { status: "ready", info: { checksum: "def" } },
    modhash: 1,
    maphash: 2,
    checksumsReady: true,
    gameFailed: false,
    mapFailed: false,
    ready: true,
  };
});

describe("a game whose switch is on", () => {
  it("hosts on the mutator, shows its compat version and advertises its hash", async () => {
    const onHost = form();
    await screen.findByText(MUTATOR.name);
    await waitFor(() => expect(hostButton().disabled).toBe(false));

    submit();
    await waitFor(() => expect(onHost).toHaveBeenCalled());
    expect(onHost.mock.calls[0]).toEqual([
      expect.objectContaining({ modname: MUTATOR.name, modhash: 16 }),
    ]);
  });

  it("reads the mutator's hash fresh, since a rebuild can change it", async () => {
    form();
    await screen.findByText(MUTATOR.name);
    expect(invalidate).toHaveBeenCalledWith(
      "/e",
      "/d",
      MUTATOR.primaryArchive.name,
    );
  });

  it("still lets the host choose the game itself", async () => {
    const onHost = form();
    await screen.findByText(MUTATOR.name);

    fireEvent.click(screen.getByRole("radio", { name: "Original game" }));
    expect(screen.queryByText(MUTATOR.name)).toBeNull();
    expect(hostButton().disabled).toBe(false);

    submit();
    await waitFor(() => expect(onHost).toHaveBeenCalled());
    expect(onHost.mock.calls[0]).toEqual([
      expect.objectContaining({ modname: XTA.name, modhash: 1 }),
    ]);
  });

  it("holds Host back while the mutator is being checked", () => {
    status.mockReturnValue(new Promise(() => {}));
    const onHost = form();
    expect(hostButton().disabled).toBe(true);
    submit();
    expect(onHost).not.toHaveBeenCalled();
  });
});

describe("a mutator that is missing or stale", () => {
  it("blocks the host when it is missing, until it has been built", async () => {
    status.mockResolvedValue({ latest: 24, folder: null, stale: [] });
    const onHost = form();
    await screen.findByText("Not built");
    expect(screen.getByText(MUTATOR.name)).toBeTruthy();
    expect(hostButton().disabled).toBe(true);
    submit();
    expect(onHost).not.toHaveBeenCalled();

    status.mockResolvedValue(BUILT);
    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    await waitFor(() => expect(hostButton().disabled).toBe(false));
    expect(build).toHaveBeenCalledWith({
      dataDir: "/d",
      enginePath: "/e",
      archiveName: "xta-9.65.sd7",
      gameName: "XTA 9.65",
      baseChecksum: "abc",
      manifestVersion: 24,
      onProgress: expect.anything(),
    });
  });

  it("blocks the host when it is stale, and says why", async () => {
    status.mockResolvedValue({
      latest: 24,
      folder: "coilbox-compat-xta-9.65-23.sdd",
      stale: [{ kind: "manifest", built: 23, now: 24 }],
    });
    const onHost = form();
    await screen.findByText(/Out of date/);
    expect(hostButton().disabled).toBe(true);
    submit();
    expect(onHost).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Rebuild" })).toBeTruthy();
  });

  it("blocks the host when the engine does not list it", async () => {
    scan.mockResolvedValue({ games: [XTA] });
    form();
    await screen.findByText(/did not find/);
    expect(hostButton().disabled).toBe(true);
  });

  it("shows the count while it builds, and a build that fails", async () => {
    status.mockResolvedValue({ latest: 24, folder: null, stale: [] });
    let fail: (e: Error) => void = () => {};
    build.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    form();
    fireEvent.click(await screen.findByRole("button", { name: "Build" }));
    await waitFor(() => expect(build).toHaveBeenCalled());

    const channel = build.mock.calls[0][0].onProgress;
    act(() => channel.onmessage({ phase: "model", done: 40, total: 300 }));
    expect(screen.getByText(/40 of/)).toBeTruthy();
    expect(hostButton().disabled).toBe(true);

    await act(async () => fail(new Error("disk full")));
    await screen.findByText("disk full");
    expect(hostButton().disabled).toBe(true);
  });
});

describe("a room on this machine", () => {
  it("opens its battle on the mutator, and is blocked while that is missing", async () => {
    status.mockResolvedValue({ latest: 24, folder: null, stale: [] });
    const onStart = vi.fn(async () => undefined);
    const { unmount } = render(
      <PersistentStoreProvider>
        <DrawerProvider>
          <HostRoomForm blocked={null} defaultName="alice" onStart={onStart} />
        </DrawerProvider>
      </PersistentStoreProvider>,
    );
    const start = () =>
      screen.getByRole("button", { name: /start/i }) as HTMLButtonElement;
    await screen.findByText("Not built");
    expect(start().disabled).toBe(true);
    unmount();

    status.mockResolvedValue(BUILT);
    render(
      <PersistentStoreProvider>
        <DrawerProvider>
          <HostRoomForm blocked={null} defaultName="alice" onStart={onStart} />
        </DrawerProvider>
      </PersistentStoreProvider>,
    );
    await screen.findByText(MUTATOR.name);
    await waitFor(() => expect(start().disabled).toBe(false));
    fireEvent.click(start());
    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(onStart.mock.calls[0]).toEqual([
      expect.objectContaining({
        battle: expect.objectContaining({
          modname: MUTATOR.name,
          modhash: 16,
        }),
      }),
    ]);
  });
});

describe("a game whose switch is off", () => {
  it.each([
    ["has no entry", {}],
    ["is switched off", { "xta-9.65.sd7": { enabled: false, version: 24 } }],
    [
      "only has another game on",
      { "other.sd7": { enabled: true, version: 1 } },
    ],
  ])("offers only the game when it %s", async (_n, on) => {
    settings.current = on;
    const onHost = form();

    expect(screen.queryByRole("radio", { name: "Compatibility mode" })).toBe(
      null,
    );
    expect(hostButton().disabled).toBe(false);
    submit();
    await waitFor(() => expect(onHost).toHaveBeenCalled());
    expect(onHost.mock.calls[0]).toEqual([
      expect.objectContaining({ modname: XTA.name, modhash: 1 }),
    ]);
    expect(status).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });
});
