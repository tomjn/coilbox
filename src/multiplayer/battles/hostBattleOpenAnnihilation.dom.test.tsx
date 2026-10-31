// @vitest-environment happy-dom

/**
 * Hosting an Open Annihilation battle from the "Host a battle" drawer (issue
 * #4946). OA is an engine choice once its program is set. Choosing it leaves
 * out the game and map pickers and the way a Recoil battle is reached, caps the
 * player limit at 10, and sends the OPENBATTLE fields the lobby agreed to.
 */

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { DrawerProvider, PersistentStoreProvider } from "@picoframe/frame";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OA = {
  path: "/Applications/Open Annihilation.app/Contents/MacOS/open-annihilation",
  version: "Open Annihilation 0.8.9 (macos-universal arm64, 9eb18ad4)",
};
const OA_NOW = "Open Annihilation 0.8.10 (macos-universal arm64, fb69ee3b)";

const bindings = vi.hoisted(() => ({
  playOaCheck: vi.fn(),
  playOaMaps: vi.fn(),
}));
vi.mock("../../play/bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../play/bindings")>()),
  ...bindings,
}));
vi.mock("@/play/bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../play/bindings")>()),
  ...bindings,
}));

const settings: Record<string, unknown> = {};
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (key: string, initial: unknown) => {
    const [value, set] = useState(key in settings ? settings[key] : initial);
    return [
      value,
      (next: unknown) => {
        settings[key] = next;
        set(next);
      },
    ];
  },
}));

vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("../../direct/ReachablePorts", () => ({
  ReachablePorts: () => <div data-testid="recoil-ports" />,
}));

const reachability = vi.hoisted(() => ({ directClosePorts: vi.fn() }));
vi.mock("../../direct/reachability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../direct/reachability")>()),
  ...reachability,
}));

vi.mock("../../direct/bindings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../direct/bindings")>()),
  directVpnRoute: vi.fn(async () => ({ vpn: null })),
}));

vi.mock("./useHostContent", () => ({
  useHostContent: () => ({
    targets: [],
    target: {
      engineVersion: "105.1.1",
      syncVersion: "105.1.1",
      enginePath: "/e",
      dataDir: "/d",
    },
    games: [{ name: "Balanced Annihilation" }],
    maps: [{ name: "Comet Catcher Redux" }],
    scanning: false,
    noEngine: false,
    gameName: "Balanced Annihilation",
    setGameName: vi.fn(),
    mapName: "Comet Catcher Redux",
    setMapName: vi.fn(),
    gameInfo: { status: "ready", info: { checksum: "1a2b3c4d" } },
    mapInfo: { status: "ready", info: { checksum: "5e6f7a8b" } },
    modhash: 1,
    maphash: 2,
    checksumsReady: true,
    gameFailed: false,
    mapFailed: false,
    ready: true,
  }),
  hashFailureMessage: () => "",
}));

import { HostBattleForm, type OpenBattleArgs } from "./HostBattleForm";

function form() {
  const opened: OpenBattleArgs[] = [];
  render(
    <I18nProvider i18n={i18n}>
      <PersistentStoreProvider>
        <DrawerProvider>
          <HostBattleForm
            relayAvailable
            onHost={async (args) => {
              opened.push(args);
            }}
          />
        </DrawerProvider>
      </PersistentStoreProvider>
    </I18nProvider>,
  );
  return opened;
}

/** The engine choice, which is the first select in the form. */
const engineSelect = () => screen.getAllByRole("combobox")[0];

const chooseOa = () =>
  fireEvent.change(engineSelect(), { target: { value: "open-annihilation" } });

const host = () =>
  fireEvent.click(screen.getByRole("button", { name: "Host battle" }));

beforeEach(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
  for (const key of Object.keys(settings)) delete settings[key];
  settings["multiplayer.openAnnihilation"] = OA;
  reachability.directClosePorts.mockReset().mockResolvedValue({ closed: true });
  bindings.playOaCheck
    .mockReset()
    .mockResolvedValue({ path: OA.path, version: OA_NOW });
  bindings.playOaMaps.mockReset().mockResolvedValue({
    maps: [
      { shownName: "Acid Pools", key: "Acid Pools" },
      { shownName: "Shew Drop", key: "Comet Catcher" },
    ],
  });
});
afterEach(cleanup);

describe("Open Annihilation as an engine choice", () => {
  it("is not offered while no program is set", () => {
    settings["multiplayer.openAnnihilation"] = null;
    form();
    expect(
      screen.queryByRole("option", { name: "Open Annihilation" }),
    ).toBeNull();
  });

  it("is offered once the program is set", () => {
    form();
    expect(
      screen.getByRole("option", { name: "Open Annihilation" }),
    ).toBeTruthy();
  });

  it("hides the game and the way a Recoil battle is reached, and caps the limit at 10", () => {
    form();
    expect(screen.getByText("Game")).toBeTruthy();
    expect(screen.getByLabelText("Port")).toBeTruthy();

    chooseOa();

    expect(screen.queryByText("Game")).toBeNull();
    expect(screen.queryByLabelText("Port")).toBeNull();
    expect(screen.queryByText("Server relay")).toBeNull();
    expect(screen.getByLabelText("Title")).toBeTruthy();
    expect(screen.getByLabelText("Password (optional)")).toBeTruthy();
    const limit = screen.getByLabelText("Max players") as HTMLInputElement;
    expect(limit.max).toBe("10");
    fireEvent.change(limit, { target: { value: "20" } });
    expect(limit.value).toBe("10");
  });
});

describe("the ports an Open Annihilation host forwards (issue #4950)", () => {
  it("names the three ranges and offers no relay", () => {
    settings["multiplayer.relayMode"] = "always";
    form();
    expect(screen.getByTestId("recoil-ports")).toBeTruthy();
    expect(screen.getByText("Server relay")).toBeTruthy();

    chooseOa();

    expect(screen.queryByTestId("recoil-ports")).toBeNull();
    expect(screen.getByText("Ports to forward")).toBeTruthy();
    expect(screen.getByText("UDP 47624")).toBeTruthy();
    expect(screen.getByText("TCP 2300-2400")).toBeTruthy();
    expect(screen.getByText("UDP 2350-2400")).toBeTruthy();
    expect(screen.queryByText("Server relay")).toBeNull();
    expect(screen.queryByText(/relay/i)).toBeNull();
  });

  it("hands back a Recoil port opened before the switch", () => {
    form();
    reachability.directClosePorts.mockClear();
    chooseOa();
    expect(reachability.directClosePorts).toHaveBeenCalledTimes(1);
  });

  it("brings the Recoil panel back when the host switches engine again", () => {
    form();
    chooseOa();
    fireEvent.change(engineSelect(), { target: { value: "105.1.1" } });
    expect(screen.getByTestId("recoil-ports")).toBeTruthy();
    expect(screen.queryByText("Ports to forward")).toBeNull();
  });

  it("never advertises a relayed battle, even when the relay is set to always", async () => {
    settings["multiplayer.relayMode"] = "always";
    const opened = form();
    chooseOa();
    host();

    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0].relay).toBe(false);
    expect(opened[0].port).toBe(8452);
  });
});

describe("opening an Open Annihilation battle", () => {
  it("sends the agreed fields, with the version read again", async () => {
    const opened = form();
    chooseOa();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Friday night" },
    });
    fireEvent.change(screen.getByLabelText("Max players"), {
      target: { value: "6" },
    });
    host();

    await waitFor(() => expect(opened).toHaveLength(1));
    expect(bindings.playOaCheck).toHaveBeenCalledWith({ path: OA.path });
    expect(opened[0]).toMatchObject({
      engine: "Open Annihilation",
      version: OA_NOW,
      map: "Host chooses in OA",
      modname: "Total Annihilation",
      title: "[OA] Friday night",
      maxPlayers: 6,
      modhash: 1,
      maphash: 1,
      relay: false,
      key: "*",
    });
  });

  it("sends the shown name of the map the host picked", async () => {
    const opened = form();
    chooseOa();
    await waitFor(() => expect(bindings.playOaMaps).toHaveBeenCalled());
    await screen.findByRole("option", { name: "Shew Drop" });
    fireEvent.change(screen.getAllByRole("combobox")[1], {
      target: { value: "Shew Drop" },
    });
    host();

    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0].map).toBe("Shew Drop");
  });

  it("still hosts when the map list will not load", async () => {
    bindings.playOaMaps.mockRejectedValue(new Error("would not run"));
    const opened = form();
    chooseOa();
    await screen.findByRole("alert");
    host();

    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0].map).toBe("Host chooses in OA");
  });

  it("says why and opens nothing when the program no longer runs", async () => {
    bindings.playOaCheck.mockRejectedValue(new Error("it is gone"));
    const opened = form();
    chooseOa();
    host();

    await screen.findByText(/it is gone/);
    expect(opened).toHaveLength(0);
  });
});
