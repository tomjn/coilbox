// @vitest-environment happy-dom
/**
 * What a campaign row does when it is clicked, and what it still offers when it
 * is not (issue #2188).
 *
 * The row became a link and the buttons became a menu, which is three ways to
 * lose an action: a menu a keyboard cannot open, a menu trigger nobody can see
 * until they hover it (issue #2203), and a bundled campaign offered an Edit it
 * must never have. All three are pinned here, against the real menu rather than
 * a stand-in for it.
 *
 * What the row says about the campaign is at the foot of the file (issue #2187).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

// The drawer is the app shell's, so it is stubbed down to what opened in it.
// The delete confirmation lands here.
const opened: { title: string; content: React.ReactNode }[] = [];
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useDrawer: () => ({
    open: (o: { title: string; content: React.ReactNode }) => opened.push(o),
    close: () => {},
    isOpen: false,
  }),
}));

// Stored campaigns come off disk through the plugin. What is under test is the
// row built from them, not the read.
const { useCampaigns, campaignDelete, campaignExport } = vi.hoisted(() => ({
  useCampaigns: vi.fn(),
  campaignDelete: vi.fn(async () => ({})),
  campaignExport: vi.fn(async () => ({})),
}));
vi.mock("../campaigns", () => ({
  useCampaigns,
  refreshCampaigns: async () => [],
}));
vi.mock("../bindings", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../bindings")),
  campaignDelete,
  campaignExport,
}));

// Export picks its destination with the OS file dialog.
const { save } = vi.hoisted(() => ({
  save: vi.fn(async () => "/tmp/Beachhead.json"),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save, open: vi.fn() }));

vi.mock("../../play/config", () => ({ usePreferredTarget: () => ({}) }));
// The rendered minimaps a row falls back to when a campaign has no emblem. The
// real batch comes off the unitsync worker, so the tests put maps in here
// directly and every row reads the same map the app would have handed it.
const { thumbs } = vi.hoisted(() => ({
  thumbs: new Map<string, { url: string; width: number; height: number }>(),
}));
vi.mock("../../content/config", () => ({
  useUnitsyncScan: () => ({}),
  useUnitsyncThumbnails: () => ({ thumbs, loading: false }),
}));
// The emblem resolves its image through the plugin, and bears on nothing here.
vi.mock("./components/CampaignImage", () => ({
  CampaignIconBox: () => <div data-testid="icon" />,
}));

import type { LoadedCampaign } from "../campaigns";
import type { Campaign, CampaignMission } from "../model";
import CampaignBuilderPage from "./CampaignBuilderPage";

function campaignNamed(
  id: string,
  title: string,
  extra: Partial<Campaign> = {},
): Campaign {
  return {
    schemaVersion: 1,
    id,
    type: "ta",
    title,
    description: "",
    missions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

/** A mission carrying only the snapshot fields a row reads. */
function mission(gameName: string, mapName: string): CampaignMission {
  return {
    id: `${gameName}-${mapName}`,
    title: "M",
    briefing: "",
    objectives: [],
    snapshot: { gameName, mapName } as CampaignMission["snapshot"],
    disabledUnits: [],
    skippable: false,
  };
}

/** An ISO stamp the row will read back as a relative time. */
const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

const local: LoadedCampaign = {
  campaign: campaignNamed("beachhead", "Beachhead"),
  source: "local",
};

const bundled: LoadedCampaign = {
  campaign: campaignNamed("tutorial", "Tutorial"),
  source: "bundled",
};

function show(campaigns: LoadedCampaign[]) {
  useCampaigns.mockReturnValue({
    campaigns,
    loading: false,
    error: null,
    refresh: async () => {},
  });
  return render(
    <MemoryRouter initialEntries={["/campaign-builder"]}>
      <Routes>
        <Route path="/campaign-builder" element={<CampaignBuilderPage />} />
        <Route
          path="/campaign-builder/:id"
          element={<p>Editing this campaign</p>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Open a row's menu the way a keyboard does, and hand back its items. */
function openMenuByKeyboard(name: string) {
  const trigger = screen.getByRole("button", { name: `Actions for ${name}` });
  trigger.focus();
  expect(document.activeElement).toBe(trigger);
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getAllByRole("menuitem").map((item) => item.textContent);
}

afterEach(() => {
  cleanup();
  opened.length = 0;
  thumbs.clear();
  vi.clearAllMocks();
});

describe("a campaign row", () => {
  it("opens the campaign when the row itself is clicked", () => {
    show([local]);

    fireEvent.click(screen.getByRole("link", { name: /Beachhead/ }));

    expect(screen.getByText("Editing this campaign")).toBeTruthy();
  });

  it("reaches Edit, Export and Delete from the keyboard alone", () => {
    show([local]);

    expect(openMenuByKeyboard("Beachhead")).toEqual([
      expect.stringContaining("Edit"),
      expect.stringContaining("Export"),
      expect.stringContaining("Delete"),
    ]);
  });

  it("edits from the menu without a mouse", () => {
    show([local]);
    openMenuByKeyboard("Beachhead");

    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Edit/ }), {
      key: "Enter",
    });

    expect(screen.getByText("Editing this campaign")).toBeTruthy();
  });

  it("exports from the menu without a mouse", async () => {
    show([local]);
    openMenuByKeyboard("Beachhead");

    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Export/ }), {
      key: "Enter",
    });

    await vi.waitFor(() =>
      expect(campaignExport).toHaveBeenCalledWith(
        expect.objectContaining({ dest: "/tmp/Beachhead.json" }),
      ),
    );
  });

  it("asks before deleting, and deletes when the drawer says so", async () => {
    show([local]);
    openMenuByKeyboard("Beachhead");

    fireEvent.keyDown(screen.getByRole("menuitem", { name: /Delete/ }), {
      key: "Enter",
    });
    expect(opened.map((o) => o.title)).toEqual(["Delete Beachhead"]);

    // The drawer's content is the shell's to render, so it is rendered here.
    cleanup();
    render(opened[0].content);
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));

    await vi.waitFor(() =>
      expect(campaignDelete).toHaveBeenCalledWith({ id: "beachhead" }),
    );
  });

  // Issue #2203: the scenario list's version of this faded the trigger in on
  // hover, which leaves nothing to aim at on a touch screen and nothing to
  // notice at rest. Emphasis may change on hover. Existence may not.
  it("shows its menu trigger before anything is hovered", () => {
    show([local]);

    const trigger = screen.getByRole("button", {
      name: "Actions for Beachhead",
    });

    expect(trigger.className).not.toMatch(/(^|\s|:)opacity-0(\s|$)/);
    expect(trigger.className).toMatch(/group-hover:opacity-100/);
  });
});

describe("a bundled campaign's row", () => {
  it("offers no menu, because there is nothing it may do", () => {
    show([bundled]);

    expect(screen.queryByRole("button", { name: /Actions for/ })).toBeNull();
  });

  it("still opens on a row click, which explains itself", () => {
    show([bundled]);

    expect(
      screen.getByRole("link", { name: /Tutorial/ }).getAttribute("href"),
    ).toBe("/campaign-builder/tutorial");
  });
});

/**
 * What a row says about the campaign (issue #2187). The sentence itself is a
 * plain unit test in `listing.test.ts`. What is pinned here is that the row
 * shows it, that the description only takes a line when there is one, and that
 * none of it added a second thing to tab to.
 */
describe("what a campaign row says", () => {
  const beachhead: LoadedCampaign = {
    campaign: campaignNamed("beachhead", "Beachhead", {
      missions: [mission("BAR", "Comet Catcher"), mission("BAR", "Isis")],
      updatedAt: hoursAgo(2),
    }),
    source: "local",
  };

  it("names the game, the size and the last edit", () => {
    show([beachhead]);

    expect(screen.getByText("BAR · 2 missions · edited 2h ago")).toBeTruthy();
  });

  it("shows the description, on one truncated line", () => {
    show([
      {
        campaign: campaignNamed("beachhead", "Beachhead", {
          description: "Hold the landing zone until the second wave lands.",
        }),
        source: "local",
      },
    ]);

    const line = screen.getByText(
      "Hold the landing zone until the second wave lands.",
    );
    expect(line.className).toMatch(/truncate/);
  });

  it("gives a campaign with no description no line to hold it", () => {
    show([beachhead]);

    expect(screen.getByRole("link", { name: /Beachhead/ }).textContent).toBe(
      "BeachheadBAR · 2 missions · edited 2h ago",
    );
  });

  it("draws the first mission's map when there is no emblem", () => {
    thumbs.set("Comet Catcher", {
      url: "data:image/png;base64,comet",
      width: 8,
      height: 8,
    });
    const { container } = show([beachhead]);

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,comet",
    );
    expect(screen.queryByTestId("icon")).toBeNull();
  });

  it("keeps the emblem when the campaign has one, map or no map", () => {
    thumbs.set("Comet Catcher", {
      url: "data:image/png;base64,comet",
      width: 8,
      height: 8,
    });
    show([
      {
        campaign: {
          ...beachhead.campaign,
          icon: { kind: "file", file: "icon.png" },
        },
        source: "local",
      },
    ]);

    expect(screen.getByTestId("icon")).toBeTruthy();
  });

  // A map this machine does not have renders nothing, so the row falls back to
  // the campaign glyph rather than showing an empty box where a picture was.
  it("falls back to the emblem box when the map cannot be drawn", () => {
    const { container } = show([beachhead]);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByTestId("icon")).toBeTruthy();
  });

  // Everything added here is text and a picture inside the row's own link. A
  // second tab stop in a row is a list a keyboard has to walk twice.
  it("adds nothing inside the row link that takes focus", () => {
    thumbs.set("Comet Catcher", {
      url: "data:image/png;base64,comet",
      width: 8,
      height: 8,
    });
    show([beachhead]);

    const link = screen.getByRole("link", { name: /Beachhead/ });
    expect(
      link.querySelectorAll("a, button, input, select, textarea, [tabindex]"),
    ).toHaveLength(0);
  });
});
