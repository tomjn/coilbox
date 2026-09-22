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
vi.mock("@/hub/config", () => ({ useHubUrl: () => "https://hub.example" }));

// A stable empty array, not a fresh `[]` per call: the real hook (a plain
// `useState`) only ever changes identity when the catalog load resolves, and
// a mock that hands back a new array on every call churns `GamesPage`'s
// `repos`/`load` memoization into an infinite render loop that no real caller
// of the hook would ever trigger.
const NO_REPOS = vi.hoisted(() => [] as never[]);
vi.mock("@/content/branding", () => ({
  useGithubGameRepos: () => NO_REPOS,
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
