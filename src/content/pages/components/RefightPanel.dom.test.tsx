// @vitest-environment happy-dom

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigOption, DemoInfo } from "../../bindings";

const launch = vi.hoisted(() =>
  vi.fn(async (_kind: string, _args: { config: unknown }) => ({ exitCode: 0 })),
);

vi.mock("@/components/ui/popover", () => ({
  Popover: ({
    children,
    onOpenChange,
  }: {
    children: ReactNode;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onOpenChange(true)}>
        Open
      </button>
      {children}
    </div>
  ),
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/play/PlayProvider", () => ({
  usePlay: () => ({ running: false, launch }),
}));
vi.mock("@/play/pages/components/SaveAsPresetButton", () => ({
  SaveAsPresetButton: () => null,
}));
vi.mock("../../../play/tagReplayProvenance", () => ({
  tagAndIngestFreshReplay: () => {},
}));
vi.mock("../../replayList", () => ({ loadReplays: async () => [] }));
vi.mock("../../replayUserState", () => ({
  useReplayUserState: () => ({ setProvenance: () => {} }),
}));

const MAX_UNITS: ConfigOption = {
  key: "maxunits",
  name: "Max units",
  type: "number",
  default: "5000",
};

vi.mock("../../refight", () => ({
  useRefightSetup: () => ({
    target: { dataDir: "/data", executable: "/engine/spring" },
    scanLoading: false,
    shortGameId: null,
    gameCandidates: [{ name: "Game" }],
    selectedGameName: "Game",
    setSelectedGameName: () => {},
    scanFailure: null,
    missingGame: false,
    missingMap: false,
    sides: [],
    options: [MAX_UNITS],
    optionsLoading: false,
    mapOptions: [],
    ais: [{ kind: "lua", shortName: "bot", name: "Bot" }],
  }),
}));

import { RefightPanel } from "./RefightPanel";

afterEach(cleanup);

describe("refighting a replay", () => {
  // The draft drops a value at the game's declared default, and an absent key
  // means the engine's own value, which is 32000 here rather than 5000.
  it("launches on the options the replay recorded, defaults included", async () => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
    const info = {
      mapName: "Some Map",
      gameType: "Game",
      startPosType: 0,
      players: [{ name: "Ann", allyTeam: 0, spectator: false, team: 0 }],
      ais: [],
      modOptions: { maxunits: "5000" },
      mapOptions: { fog: "1" },
    } as unknown as DemoInfo;
    render(
      <I18nProvider i18n={i18n}>
        <RefightPanel info={info} filename="a.sdfz" />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(await screen.findByRole("button", { name: /Refight now/ }));

    await waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    expect(launch.mock.lastCall?.[1]?.config).toMatchObject({
      modOptions: { maxunits: "5000" },
      mapOptions: { fog: "1" },
    });
  });
});
