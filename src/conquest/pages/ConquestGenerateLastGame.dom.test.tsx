// @vitest-environment happy-dom
/**
 * The Conquest "Generate a map" form opens on the game it was last used with,
 * as long as that game is still installed and still offered in the form.
 * Without one it opens on the first game in the list, as it always did.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "conquest.generate.lastGame";

const h = vi.hoisted(() => ({
  drawerContent: null as unknown,
  installed: [] as string[],
  onlyOwnMaps: [] as string[],
  maps: [] as { id: string; game: { shortname: string } }[],
  preset: null as string | null,
}));

const ALL_GAMES: Record<string, { shortname: string }> = {
  "Alpha Game v1": { shortname: "AG" },
  "Cool Game v1": { shortname: "CG" },
  "Zed Game v1": { shortname: "ZG" },
};

// The frame's `useSetting` is stood in for by the installed storage, so a
// value written by one form is read by the next, as in the app.
vi.mock("@picoframe/frame", async (orig) => ({
  ...(await orig<typeof import("@picoframe/frame")>()),
  useDrawer: () => ({
    open: (o: { content: unknown }) => {
      h.drawerContent = o.content;
    },
    close: vi.fn(),
  }),
  useSetting: (key: string, fallback: unknown) => [
    readStoredSetting(key, fallback),
    (next: unknown) => storage.set(key, JSON.stringify(next)),
  ],
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
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("../../content/config", () => ({
  useUnitsyncScan: () => ({
    data: {
      games: h.installed.map((name) => ({
        name,
        info: { shortname: ALL_GAMES[name].shortname, version: "v1" },
        primaryArchive: { name },
      })),
      maps: [{ name: "Comet Catcher Remake", width: 16, height: 16 }],
      errors: [],
    },
    error: null,
    loading: false,
    cancelled: false,
    unvouched: null,
    run: vi.fn(),
    cancel: vi.fn(),
  }),
}));
vi.mock("../../content/branding", () => ({
  resolveBranding: () => null,
  useBrandingCatalog: () => [],
}));
vi.mock("../../content/mapEligibility", () => {
  const eligible = (m: unknown[]) => m;
  return { useMapEligibility: () => ({ eligible }) };
});
vi.mock("../../content/useGamePresetParam", () => ({
  useGamePresetParam: () => h.preset,
}));
vi.mock("../../deeplink/useImportParam", () => ({
  useImportParam: () => ({ code: null, hubItemId: null }),
}));
vi.mock("../../hub/imports", () => ({ useRecordHubImport: () => vi.fn() }));
vi.mock("../../play/useGameCatalog", () => ({ useGameCatalog: () => [] }));
vi.mock("../../play/config", () => ({
  usePlayReadiness: () => ({
    target: { enginePath: "/engine", dataDir: "/data" },
    state: "ready",
    scanErrors: [],
    scanFailure: null,
    refresh: vi.fn(),
  }),
  usePreferredTarget: () => ({
    target: { enginePath: "/engine", dataDir: "/data" },
  }),
  useSkirmishAis: () => ({
    ais: [{ shortName: "NullAI", version: "1", name: "NullAI" }],
    loading: false,
    loaded: true,
  }),
}));
vi.mock("../conquests", () => ({
  refreshGalaxies: vi.fn(),
  useGalaxies: () => ({ galaxies: [], loading: false, error: null }),
  useConquestState: () => ({ file: { conquests: {} }, saveFor: vi.fn() }),
}));
vi.mock("../../profile/profile", async (orig) => ({
  ...(await orig<typeof import("../../profile/profile")>()),
  getProfile: () => ({}),
}));
vi.mock("../handmade/useHandmadeMaps", () => ({
  refreshHandmadeMaps: vi.fn(),
  useHandmadeMaps: () => ({
    maps: h.maps,
    unreadable: [],
    onlyOwnMaps: h.onlyOwnMaps,
    loading: false,
    savedLoading: false,
    error: null,
  }),
}));
vi.mock("../bindings", () => ({
  conquestDelete: vi.fn(),
  conquestSave: vi.fn(async () => {}),
}));
vi.mock("@/factions/logos", () => ({ useFactionLogo: () => null }));
vi.mock("../useUnlocks", () => {
  const unlocks = {};
  return {
    useConquestUnlocks: () => ({ unlocks, award: vi.fn() }),
    useAwardFinishedConquest: () => {},
  };
});

import {
  installSettingsStorage,
  memorySettingsStorage,
  readStoredSetting,
} from "../../lib/storedSetting";
import ConquestListPage from "./ConquestListPage";

let storage = memorySettingsStorage();

/** Open the drawer from the page's button, then mount what it holds. */
function openForm() {
  h.drawerContent = null;
  render(
    <MemoryRouter>
      <ConquestListPage />
    </MemoryRouter>,
  );
  if (!h.drawerContent) {
    fireEvent.click(screen.getByRole("button", { name: /Generate a map/ }));
  }
  cleanup();
  render(<MemoryRouter>{h.drawerContent as ReactNode}</MemoryRouter>);
}

/** The game select, the one that lists the installed games. */
function gameSelect(): HTMLSelectElement {
  const found = [...document.querySelectorAll("select")].find((s) =>
    [...s.options].some((o) => o.textContent === "Alpha Game v1"),
  );
  if (!found) throw new Error("no select lists the games");
  return found;
}

const chosenGame = () => gameSelect().selectedOptions[0]?.textContent;

beforeEach(() => {
  storage = memorySettingsStorage();
  installSettingsStorage(storage);
  h.installed = ["Alpha Game v1", "Cool Game v1"];
  h.onlyOwnMaps = [];
  h.maps = [];
  h.preset = null;
});
afterEach(cleanup);

describe("Conquest generate form: the last game", () => {
  it("opens on the first game when nothing is remembered", () => {
    openForm();
    expect(chosenGame()).toBe("Alpha Game v1");
    expect(storage.get(KEY)).toBeNull();
  });

  it("remembers the game the player picks and opens on it next time", () => {
    openForm();
    fireEvent.change(gameSelect(), {
      target: { value: gameSelect().options[1].value },
    });
    expect(storage.get(KEY)).toBe(
      JSON.stringify(gameSelect().options[1].value),
    );
    openForm();
    expect(chosenGame()).toBe("Cool Game v1");
  });

  it("falls back to the first game when the remembered one is not installed", () => {
    openForm();
    fireEvent.change(gameSelect(), {
      target: { value: gameSelect().options[1].value },
    });
    h.installed = ["Alpha Game v1", "Zed Game v1"];
    openForm();
    expect(chosenGame()).toBe("Alpha Game v1");
  });

  it("falls back to the first game when the remembered one is hidden from the form", () => {
    openForm();
    fireEvent.change(gameSelect(), {
      target: { value: gameSelect().options[1].value },
    });
    // A game asking for its own maps only is hidden once it has a map to offer.
    h.onlyOwnMaps = ["Cool Game v1"];
    h.maps = [{ id: "cool-map", game: { shortname: "CG" } }];
    // With one game left the form shows no select, only its name.
    openForm();
    expect(document.body.textContent).toContain("Alpha Game v1");
    expect(document.body.textContent).not.toContain("Cool Game v1");
  });

  it("prefers a game named by the caller over the remembered one", () => {
    openForm();
    fireEvent.change(gameSelect(), {
      target: { value: gameSelect().options[1].value },
    });
    h.preset = "Alpha Game v1";
    openForm();
    expect(chosenGame()).toBe("Alpha Game v1");
  });

  it("remembers the game a map was created for, even when it was never picked", async () => {
    h.preset = "Cool Game v1";
    openForm();
    expect(storage.get(KEY)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create map" }));
    await waitFor(() => expect(storage.get(KEY)).not.toBeNull());
    h.preset = null;
    openForm();
    expect(chosenGame()).toBe("Cool Game v1");
  });
});
