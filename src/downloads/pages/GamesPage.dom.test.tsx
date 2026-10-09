// @vitest-environment happy-dom

/**
 * The Games page's new hub source (issue #2951): the hub lists a game and its
 * ordered download sources rather than one archive with a size, so picking it
 * exercises a different path than springfiles/GitHub-repo rows - the request
 * is resolved (and possibly a github release list is fetched) at click time,
 * through the real `hubGameDownloadRequest`, rather than read off the row.
 *
 * `OptionSelect` is stubbed with a plain `<select>`, the same reason
 * `hub/pages/BrowsePage.dom.test.tsx` gives: the real one is a Radix popover
 * with pointer-capture behaviour happy-dom does not implement, and these
 * tests are about the hub wiring, not Radix's own combobox behaviour.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetHubGames } from "@/hub/gameIcons";
import { DownloadQueueProvider } from "../DownloadQueueProvider";
import GamesPage from "./GamesPage";

const dlDownload = vi.hoisted(() => vi.fn(async () => ({})));
const fetchHubGames = vi.hoisted(() => vi.fn());

vi.mock("../bindings", () => ({
  dlCancel: vi.fn(async () => ({})),
  dlDownload,
  dlDownloadEngineRecoil: vi.fn(),
  dlDownloadEngineSpring: vi.fn(),
  dlDownloadFile: vi.fn(async () => ({})),
  dlDownloadMap: vi.fn(async () => ({})),
  dlGithubReleaseArchives: vi.fn(async () => ({ archives: [] })),
  dlHakoraMaps: vi.fn(async () => ({ maps: [] })),
  dlEvolutionRtsMaps: vi.fn(async () => ({ maps: [] })),
  dlInstalledContent: vi.fn(async () => ({ maps: [], games: [] })),
  dlSpringfilesList: vi.fn(async () => ({ results: [] })),
}));

vi.mock("../config", () => ({
  useWriteRoot: () => ({ path: "/content", loading: false }),
  useContentRootPaths: () => ["/content"],
}));

vi.mock("@/hub/api", () => ({ fetchHubGames }));
vi.mock("@/hub/config", () => ({
  useHubUrl: () => "https://hub.example",
  useTrustedHubUrl: () => "https://hub.example",
}));
vi.mock("@/hub/assets/tier", () => ({
  assetCdnBase: () => "https://assets.example/coilbox-assets/",
}));

// A hub row draws a `GameIcon`, which reads the content scan and the cached
// art. One game is installed, so a row can be either kind.
const SCAN = vi.hoisted(() => ({
  target: { selected: { enginePath: "/e", rootPath: "/r" } },
  scan: {
    data: {
      games: [
        {
          name: "Splinter Faction 0.1.86",
          info: { shortname: "sf", version: "0.1.86" },
        },
      ],
    },
  },
  headers: { headers: new Map() },
}));
vi.mock("@/content/config", () => ({
  useScanTargetSelection: () => SCAN.target,
  useUnitsyncScan: () => SCAN.scan,
  useUnitsyncGameHeaders: () => SCAN.headers,
}));

// A stable empty array, not a fresh `[]` per call: the real hook (a plain
// `useState`) only ever changes identity when the catalog load resolves, and
// a mock that hands back a new array on every call churns `GamesPage`'s
// `repos`/`load` memoization into an infinite render loop that no real caller
// of the hook would ever trigger.
const NO_REPOS = vi.hoisted(() => [] as never[]);
vi.mock("@/content/branding", () => ({
  useGithubGameRepos: () => NO_REPOS,
  resolveBranding: () => null,
  useBrandingCatalog: () => NO_REPOS,
  useBrandingImage: () => undefined,
  // The cache hands back a local file for any address it is given.
  useCachedImage: (urls?: string[]) =>
    urls?.length ? `cache://${urls[0]}` : undefined,
}));

vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
  }: {
    value: string;
    onValueChange: (value: string) => void;
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

vi.mock("@picoframe/frame", () => ({
  Button: ({
    children,
    ...props
  }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Input: (props: Record<string, unknown>) => <input {...props} />,
  useSetting: (_key: string, initial: unknown) => [initial, vi.fn()],
}));

beforeEach(() => {
  (
    globalThis as unknown as { window: Record<string, unknown> }
  ).window.__TAURI_INTERNALS__ = { transformCallback: (cb: unknown) => cb };
  // The icons read the hub's list a second time, through a cache that outlives
  // a test. Left unanswered, that read finds no pictures.
  resetHubGames();
  fetchHubGames.mockReset();
  fetchHubGames.mockResolvedValue({ ok: false, reason: "down" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Pick "coilbox hub" from the (stubbed) source select. */
async function pickHubSource() {
  const select = await screen.findByDisplayValue("springfiles");
  fireEvent.change(select, { target: { value: "hub" } });
}

describe("the Games page's hub source", () => {
  it("lists the games and lets you drill into a hub game's own downloads", async () => {
    fetchHubGames.mockResolvedValueOnce({
      ok: true,
      value: [
        {
          shortname: "BA",
          title: "Balanced Annihilation",
          description: null,
          featured: true,
          downloads: [{ kind: "rapid", value: "ba:stable" }],
          logo: null,
          card: null,
          faction_count: 2,
          unit_count: 400,
          item_count: 12,
        },
      ],
    });

    render(
      <DownloadQueueProvider>
        <GamesPage />
      </DownloadQueueProvider>,
    );

    await pickHubSource();

    expect(await screen.findByText("Balanced Annihilation")).toBeTruthy();
    expect(screen.getByText("via rapid")).toBeTruthy();
  });

  it("offers no download for a hub game the hub lists no source for", async () => {
    // An empty list, not a missing one: it is what the hub sends for a game it
    // knows about and cannot point at, and an empty array is truthy.
    fetchHubGames.mockResolvedValueOnce({
      ok: true,
      value: [
        {
          shortname: "byar",
          title: "Beyond All Reason",
          description: null,
          featured: false,
          downloads: [],
          logo: null,
          card: null,
          faction_count: 2,
          unit_count: 400,
          item_count: 12,
        },
      ],
    });

    render(
      <DownloadQueueProvider>
        <GamesPage />
      </DownloadQueueProvider>,
    );

    await pickHubSource();

    expect(
      await screen.findByText("The hub lists no download for this game."),
    ).toBeTruthy();
    expect(screen.queryByText(/^via\s*$/)).toBeNull();
    const button = screen.getByRole("button", {
      name: "No download for Beyond All Reason",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("gives every hub row an icon box of one size, holding a picture or a placeholder", async () => {
    const logo = (shortname: string) =>
      `https://assets.example/coilbox-assets/games/${shortname}/logo.png`;
    const game = (shortname: string, title: string, hasLogo: boolean) => ({
      shortname,
      title,
      description: null,
      featured: false,
      downloads: [{ kind: "rapid", value: `${shortname}:stable` }],
      logo: hasLogo ? logo(shortname) : null,
      card: null,
      faction_count: 2,
      unit_count: 400,
      item_count: 12,
    });
    // Answers both reads: the page's list and the icons' own.
    fetchHubGames.mockResolvedValue({
      ok: true,
      value: [
        game("SF", "Splinter Faction", true),
        game("ZK", "Zero-K", true),
        game("byar", "Beyond All Reason", false),
      ],
    });

    render(
      <DownloadQueueProvider>
        <GamesPage />
      </DownloadQueueProvider>,
    );
    await pickHubSource();
    await screen.findByText("Zero-K");

    const iconFor = (title: string) =>
      screen
        .getByText(title)
        .closest("li")
        ?.querySelector('[data-testid="game-icon"]') as HTMLElement;
    // Installed, with a hub logo.
    await waitFor(() =>
      expect(
        iconFor("Splinter Faction").querySelector("img")?.getAttribute("src"),
      ).toBe(`cache://${logo("SF")}`),
    );
    // Not installed, so only its shortname can find the hub's entry.
    expect(iconFor("Zero-K").querySelector("img")?.getAttribute("src")).toBe(
      `cache://${logo("ZK")}`,
    );
    // No picture anywhere.
    expect(iconFor("Beyond All Reason").dataset.state).toBe("placeholder");

    const boxes = screen.getAllByTestId("game-icon");
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      expect(box.style.width).toBe(box.style.height);
      expect(box.style.width).toBe(boxes[0].style.width);
    }
  });

  it("draws no icon on a source that is not the hub", async () => {
    const { dlSpringfilesList } = await import("../bindings");
    vi.mocked(dlSpringfilesList).mockResolvedValueOnce({
      results: [
        {
          springname: "Some Game 1.0",
          name: "Some Game",
          filename: "some_game.sdz",
          size: 10,
          mirrors: ["https://springfiles.example/some_game.sdz"],
        },
      ],
    } as never);

    render(
      <DownloadQueueProvider>
        <GamesPage />
      </DownloadQueueProvider>,
    );

    expect(await screen.findByText("Some Game")).toBeTruthy();
    expect(screen.queryByTestId("game-icon")).toBeNull();
  });

  it("shows the hub's own reason when the catalog could not be read", async () => {
    fetchHubGames.mockResolvedValueOnce({
      ok: false,
      reason: "The hub may be waking up after a quiet spell.",
    });

    render(
      <DownloadQueueProvider>
        <GamesPage />
      </DownloadQueueProvider>,
    );

    await pickHubSource();

    expect(
      await screen.findByText("The hub may be waking up after a quiet spell."),
    ).toBeTruthy();
  });

  it("queues the hub game's rapid source when the download button is pressed", async () => {
    fetchHubGames.mockResolvedValueOnce({
      ok: true,
      value: [
        {
          shortname: "BA",
          title: "Balanced Annihilation",
          description: null,
          featured: true,
          downloads: [{ kind: "rapid", value: "ba:stable" }],
          logo: null,
          card: null,
          faction_count: 2,
          unit_count: 400,
          item_count: 12,
        },
      ],
    });

    render(
      <DownloadQueueProvider>
        <GamesPage />
      </DownloadQueueProvider>,
    );

    await pickHubSource();
    const button = await screen.findByRole("button", {
      name: /Download Balanced Annihilation/,
    });
    button.click();

    await waitFor(() =>
      expect(dlDownload).toHaveBeenCalledWith(
        expect.objectContaining({ tag: "ba:stable" }),
      ),
    );
  });
});
