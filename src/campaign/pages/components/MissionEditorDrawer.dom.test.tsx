// @vitest-environment happy-dom
/**
 * What the mission editor keeps, and what it hands to the page behind it
 * (issue #2260).
 *
 * The drawer used to buffer everything in local state until Apply, so Cancel,
 * Escape and a click on the backdrop each threw away whatever had been typed
 * without a word. It now saves as it goes, which makes every one of those three
 * a way of closing rather than a way of losing, and leaves Revert as the only
 * action that takes work back.
 *
 * The other half is the media. Picking a file imports it there and then, and
 * the drawer used to have to delete its own imports because the page's diff
 * works from the stored document and that document had never named them.
 * Saving on change is what hands that job over: the stored document names an
 * import the moment it is made, so the page can see it, and the drawer deletes
 * nothing itself (issues #2210, #2231 and #2232).
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Picking a file is an OS dialog and importing it writes to app-data, so both
// stand in. What is asserted is what the drawer then hands to the page.
const { open, campaignMediaImport, campaignImageImport, campaignMediaDelete } =
  vi.hoisted(() => ({
    open: vi.fn(async () => "/Users/somebody/retake.ogg"),
    campaignMediaImport: vi.fn(async () => ({ file: "imported-2.ogg" })),
    campaignImageImport: vi.fn(async () => ({ file: "imported.jpg" })),
    campaignMediaDelete: vi.fn(
      async (_args: {
        campaignId: string;
        file: string;
      }): Promise<{ deleted: boolean; from: "images" | "media" | null }> => ({
        deleted: true,
        from: "media",
      }),
    ),
  }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));
vi.mock("../../bindings", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("../../bindings")),
  campaignMediaImport,
  campaignImageImport,
  campaignMediaDelete,
}));

// Everything that reaches for stored media over the coilbox:// protocol, or
// for a game's units through unitsync, stands in: a test has no business
// standing either up, and neither decides what is saved.
vi.mock("../../panorama", () => ({ useCampaignImage: () => null }));
vi.mock("@/content/useGameUnits", () => ({
  useGameUnits: () => ({ units: [], factions: [], loading: false }),
}));
vi.mock("../../../content/pages/components/UnitPicker", () => ({
  UnitGameProvider: ({ children }: { children: React.ReactNode }) => children,
  UnitPickerButton: () => null,
}));
vi.mock("./MissionMapPreview", () => ({
  MissionMapBackground: () => null,
  MissionMapSideGraphic: () => null,
}));
vi.mock("./MissionUnitPreview", () => ({
  MissionUnitBackground: () => null,
  MissionUnitSideGraphic: () => null,
}));
vi.mock("./PanoramaScroller", () => ({ PanoramaScroller: () => null }));
vi.mock("./MissionScenarioField", () => ({ MissionScenarioField: () => null }));
vi.mock("./ArchiveMediaImportButton", () => ({
  ArchiveMediaImportButton: () => null,
}));
vi.mock("./UnitRestrictions", () => ({ UnitRestrictions: () => null }));
vi.mock("./useMissionUnit", () => ({ useMissionUnit: () => ({}) }));

import { DrawerHost, DrawerProvider, useDrawer } from "@picoframe/frame";
import { StrictMode, useEffect } from "react";
import { newScenario } from "@/scenario/create";
import type { Scenario } from "@/scenario/model";
import { attachScenario } from "../../missionScenario";
import type { CampaignMission } from "../../model";
import { MissionEditorDrawer } from "./MissionEditorDrawer";

/** A mission whose voiceover the campaign has already saved. */
function mission(over: Partial<CampaignMission> = {}): CampaignMission {
  return {
    id: "m1",
    title: "Beachhead",
    briefing: "",
    objectives: [],
    snapshot: newScenario("Beachhead").setup,
    disabledUnits: [],
    skippable: false,
    ...over,
  };
}

/**
 * Open the editor the way the page opens it: as the content of the frame's own
 * drawer.
 *
 * Rendering the body on its own would test one way out, the button, and the
 * button is the one least likely to break. Escape and a click on the backdrop
 * go through Radix without ever reaching the drawer body. Driving the real
 * drawer is what makes them testable at all.
 */
function openDrawer(
  m: CampaignMission,
  onSave: (mission: CampaignMission) => Promise<void> = async () => {},
  strict = false,
) {
  function Opener() {
    const { open } = useDrawer();
    useEffect(() => {
      open({
        title: `Edit mission: ${m.title}`,
        content: (
          <MissionEditorDrawer campaignId="c1" mission={m} onSave={onSave} />
        ),
      });
    }, [open]);
    return null;
  }

  const tree = (
    <DrawerProvider>
      <Opener />
      <DrawerHost />
    </DrawerProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

/** Let anything already queued run: a pending promise, or a zero timer. */
const tick = () => new Promise((r) => setTimeout(r, 0));

/** The three ways an author gets out of the drawer. */
const EXITS = {
  "the Close button": async () =>
    screen.getByRole("button", { name: "Close" }).click(),
  Escape: async () => fireEvent.keyDown(document, { key: "Escape" }),
  "a click on the backdrop": async () => {
    // Radix arms the outside-press listener on a zero timer, so a drawer
    // dismissed in the same tick it opened in stays open.
    await tick();
    const overlay = [...document.querySelectorAll<HTMLElement>("[data-state]")]
      // The drawer's own backdrop, the only element painted over everything.
      .find((e) => e.className.includes("bg-black/50"));
    if (!overlay) throw new Error("no drawer backdrop");
    // Radix defers a left-button dismissal to the click, so the press alone
    // leaves the drawer open. Both halves of the click, then.
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
  },
} as const;

/**
 * Wait for the drawer to have gone, so its closing write has run.
 *
 * Title, because it is in the group that is open when the drawer opens. This
 * used to watch for "Briefing voiceover", which now starts inside a collapsed
 * group and so is never on screen to wait for (issue #2261).
 */
async function drawerClosed() {
  await waitFor(() => expect(screen.queryByLabelText("Title")).toBeNull());
}

/** Type into a labelled text box, without leaving it. */
function type(label: string, value: string) {
  const field = screen.getByLabelText(label);
  fireEvent.change(field, { target: { value } });
  return field;
}

/** Open one of the drawer's groups, if it is not already open. */
function expand(group: string) {
  const trigger = screen.getByRole("button", {
    name: new RegExp(`^${group}`),
  });
  if (trigger.getAttribute("data-state") === "closed") fireEvent.click(trigger);
}

/** Choose or replace one media slot, through the OS file dialog. */
async function pickMedia(label: string, choose: string) {
  // The media slots live in the Presentation group, which starts collapsed.
  expand("Presentation");
  const field = screen.getByText(label).parentElement;
  if (!field) throw new Error(`no ${label} field`);
  const button = [...field.querySelectorAll("button")].find((b) =>
    [choose, "Replace"].includes(b.textContent?.trim() ?? ""),
  );
  if (!button) throw new Error(`no ${label} pick button`);
  const before = campaignMediaImport.mock.calls.length;
  button.click();
  await waitFor(() =>
    expect(campaignMediaImport.mock.calls.length).toBeGreaterThan(before),
  );
}

const pickVoiceover = () => pickMedia("Briefing voiceover", "Choose audio");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  campaignMediaDelete.mockClear();
  campaignMediaImport.mockClear();
  campaignMediaImport.mockResolvedValue({ file: "imported-1.ogg" });
  // Which groups are open is remembered across drawers, so one test opening
  // one would otherwise decide what the next test sees (issue #2261).
  localStorage.clear();
});

describe("a text box", () => {
  it("saves what was typed when it loses focus", async () => {
    const saved: CampaignMission[] = [];
    openDrawer(mission(), async (m) => {
      saved.push(m);
    });

    fireEvent.blur(type("Subtitle", "Sector 9"));

    await waitFor(() => expect(saved.at(-1)?.subtitle).toBe("Sector 9"));
    expect(screen.getByText(/^Saved /)).toBeTruthy();
  });

  it("says the change is unsaved until then", () => {
    openDrawer(mission());

    type("Subtitle", "Sector 9");

    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });

  it("does not write again when nothing was typed", async () => {
    const saved: CampaignMission[] = [];
    openDrawer(mission(), async (m) => {
      saved.push(m);
    });

    fireEvent.blur(screen.getByLabelText("Subtitle"));

    await tick();
    expect(saved).toEqual([]);
  });
});

describe("every way out of the drawer (issue #2260)", () => {
  // The bug: Cancel, Escape and a click on the backdrop each threw away
  // everything typed, on a page whose own fields autosave. Escape is the one
  // that cannot rely on a blur, because the box it closes over keeps focus.
  for (const [how, exit] of Object.entries(EXITS)) {
    it(`keeps what was typed when closed by ${how}`, async () => {
      const saved: CampaignMission[] = [];
      openDrawer(mission(), async (m) => {
        saved.push(m);
      });

      type("Subtitle", "Sector 9");
      await exit();
      await drawerClosed();

      await waitFor(() => expect(saved.at(-1)?.subtitle).toBe("Sector 9"));
    });
  }

  it("writes once, not once per keystroke", async () => {
    const saved: CampaignMission[] = [];
    openDrawer(mission(), async (m) => {
      saved.push(m);
    });

    type("Briefing", "Hold");
    type("Briefing", "Hold the line");
    await EXITS.Escape();
    await drawerClosed();

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.briefing).toBe("Hold the line");
  });

  it("writes nothing when nothing was changed", async () => {
    const saved: CampaignMission[] = [];
    openDrawer(mission(), async (m) => {
      saved.push(m);
    });

    await EXITS["the Close button"]();
    await drawerClosed();

    await tick();
    expect(saved).toEqual([]);
  });

  it("writes nothing on StrictMode's extra mount", async () => {
    // The app renders under StrictMode, which mounts, tears down and mounts
    // again, so the closing write runs once with the drawer still on screen.
    const saved: CampaignMission[] = [];
    openDrawer(
      mission(),
      async (m) => {
        saved.push(m);
      },
      true,
    );

    await tick();
    expect(saved).toEqual([]);
    // Still on screen: the sentinel is Title rather than the voiceover field,
    // which now starts inside a collapsed group (issue #2261).
    expect(screen.getByLabelText("Title")).toBeTruthy();
  });
});

describe("a control that is not a text box", () => {
  it("saves as it is changed", async () => {
    const saved: CampaignMission[] = [];
    openDrawer(mission(), async (m) => {
      saved.push(m);
    });

    screen.getByRole("switch", { name: /Skippable/ }).click();

    await waitFor(() => expect(saved.at(-1)?.skippable).toBe(true));
  });
});

describe("a blank objective (issue #2264)", () => {
  it("is kept on save, rather than stripped as a second, unstated removal rule", async () => {
    const saved: CampaignMission[] = [];
    openDrawer(mission(), async (m) => {
      saved.push(m);
    });

    screen.getByRole("button", { name: "Add objective" }).click();

    await waitFor(() => expect(saved.at(-1)?.objectives).toEqual([""]));
  });

  it("stays on screen after losing focus, rather than vanishing under the author", async () => {
    const saved: CampaignMission[] = [];
    openDrawer(mission(), async (m) => {
      saved.push(m);
    });

    screen.getByRole("button", { name: "Add objective" }).click();
    await waitFor(() => expect(saved.at(-1)?.objectives).toEqual([""]));

    fireEvent.blur(screen.getByPlaceholderText("Objective 1"));

    await tick();
    expect(screen.getByPlaceholderText("Objective 1")).toBeTruthy();
    expect(saved.at(-1)?.objectives).toEqual([""]);
  });

  it("saves the text typed into it", async () => {
    const saved: CampaignMission[] = [];
    openDrawer(mission(), async (m) => {
      saved.push(m);
    });

    screen.getByRole("button", { name: "Add objective" }).click();
    await waitFor(() => expect(saved.at(-1)?.objectives).toEqual([""]));

    const field = screen.getByPlaceholderText("Objective 1");
    fireEvent.change(field, { target: { value: "Destroy the relay" } });
    fireEvent.blur(field);

    await waitFor(() =>
      expect(saved.at(-1)?.objectives).toEqual(["Destroy the relay"]),
    );
  });

  it("is removed only by its own Remove button, not by leaving it blank", async () => {
    const saved: CampaignMission[] = [];
    openDrawer(mission(), async (m) => {
      saved.push(m);
    });

    screen.getByRole("button", { name: "Add objective" }).click();
    await waitFor(() => expect(saved.at(-1)?.objectives).toEqual([""]));
    fireEvent.blur(screen.getByPlaceholderText("Objective 1"));
    await tick();

    screen.getByRole("button", { name: "Remove objective 1" }).click();

    await waitFor(() => expect(saved.at(-1)?.objectives).toEqual([]));
    expect(screen.queryByPlaceholderText("Objective 1")).toBeNull();
  });

  it("survives a close and reopen with what was saved, still blank", async () => {
    let saved = mission();
    openDrawer(saved, async (m) => {
      saved = m;
    });

    screen.getByRole("button", { name: "Add objective" }).click();
    await waitFor(() => expect(saved.objectives).toEqual([""]));

    await EXITS["the Close button"]();
    await drawerClosed();

    openDrawer(saved, async (m) => {
      saved = m;
    });

    expect(screen.getByPlaceholderText("Objective 1")).toHaveProperty(
      "value",
      "",
    );
  });
});

describe("Revert", () => {
  it("is offered only once something has changed", async () => {
    openDrawer(mission());

    const revert = screen.getByRole("button", { name: "Revert" });
    expect(revert.hasAttribute("disabled")).toBe(true);

    fireEvent.blur(type("Subtitle", "Sector 9"));

    await waitFor(() => expect(revert.hasAttribute("disabled")).toBe(false));
  });

  it("puts the mission back as it was, and saves that", async () => {
    const saved: CampaignMission[] = [];
    openDrawer(mission({ subtitle: "Sector 4" }), async (m) => {
      saved.push(m);
    });

    fireEvent.blur(type("Subtitle", "Sector 9"));
    await waitFor(() => expect(saved.at(-1)?.subtitle).toBe("Sector 9"));

    screen.getByRole("button", { name: "Revert" }).click();
    // Two buttons say Revert once the popover is up: the trigger, and the
    // confirmation inside it.
    const confirm = await waitFor(() => {
      const [, inPopover] = screen.getAllByRole("button", { name: "Revert" });
      if (!inPopover) throw new Error("no revert confirmation");
      return inPopover;
    });
    confirm.click();

    await waitFor(() => expect(saved.at(-1)?.subtitle).toBe("Sector 4"));
    expect(screen.getByLabelText("Subtitle")).toHaveProperty(
      "value",
      "Sector 4",
    );
  });
});

/**
 * The panel on its own, with no drawer around it.
 *
 * Both of these are about what happens before the drawer closes rather than
 * after, and the drawer's own exit gets in the way of asking that: the panel
 * stays on screen while it slides out, so a write that only happened on the
 * unmount would still look like it worked here while being lost in the app.
 */
function renderPanel(
  m: CampaignMission,
  onSave: (mission: CampaignMission) => Promise<void>,
) {
  return render(
    <DrawerProvider>
      <MissionEditorDrawer campaignId="c1" mission={m} onSave={onSave} />
    </DrawerProvider>,
  );
}

describe("closing over a text box that still has focus", () => {
  it("writes on Escape, before anything unmounts", async () => {
    const saved: CampaignMission[] = [];
    renderPanel(mission(), async (x) => {
      saved.push(x);
    });

    const box = type("Subtitle", "Sector 9");
    fireEvent.keyDown(box, { key: "Escape" });

    await waitFor(() => expect(saved.at(-1)?.subtitle).toBe("Sector 9"));
    expect(screen.getByLabelText("Subtitle")).toBeTruthy();
  });

  it("writes on a press outside the panel, before anything unmounts", async () => {
    const saved: CampaignMission[] = [];
    renderPanel(mission(), async (x) => {
      saved.push(x);
    });

    type("Subtitle", "Sector 9");
    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(saved.at(-1)?.subtitle).toBe("Sector 9"));
  });

  it("writes on Close, which a keyboard can reach without a blur", async () => {
    const saved: CampaignMission[] = [];
    renderPanel(mission(), async (x) => {
      saved.push(x);
    });

    type("Subtitle", "Sector 9");
    screen.getByRole("button", { name: "Close" }).click();

    await waitFor(() => expect(saved.at(-1)?.subtitle).toBe("Sector 9"));
  });

  it("leaves a press inside the panel alone", async () => {
    const saved: CampaignMission[] = [];
    renderPanel(mission(), async (x) => {
      saved.push(x);
    });

    const box = type("Subtitle", "Sector 9");
    fireEvent.pointerDown(box);

    await tick();
    expect(saved).toEqual([]);
  });
});

describe("a second mission opened before the panel has gone", () => {
  it("shows that mission, rather than the one still in state", async () => {
    // The panel goes when its slide-out ends, so a drawer opened in that window
    // hands a new mission to a component still holding the last one. Saving as
    // you go turns that from the wrong fields on screen into the wrong fields
    // written over the mission you are looking at.
    const saved: CampaignMission[] = [];
    const save = async (x: CampaignMission) => {
      saved.push(x);
    };
    const first = mission({ id: "m1", subtitle: "Sector 4" });
    const second = mission({ id: "m2", title: "Aqua Regis" });
    const { rerender } = renderPanel(first, save);

    type("Subtitle", "Sector 9");
    rerender(
      <DrawerProvider>
        <MissionEditorDrawer campaignId="c1" mission={second} onSave={save} />
      </DrawerProvider>,
    );

    expect(screen.getByLabelText("Title")).toHaveProperty(
      "value",
      "Aqua Regis",
    );
    expect(screen.getByLabelText("Subtitle")).toHaveProperty("value", "");

    fireEvent.blur(type("Subtitle", "Sector 7"));
    await waitFor(() => expect(saved.at(-1)?.id).toBe("m2"));
    expect(saved.at(-1)?.subtitle).toBe("Sector 7");
  });
});

describe("an import", () => {
  it("is saved at once, so the page can see it", async () => {
    // The handover that replaced the drawer's own bookkeeping. Until the
    // stored document names the file, nothing outside this drawer can find it
    // again, which is how a 200 MB cutscene used to stay on disk for good
    // (issue #2231).
    const saved: CampaignMission[] = [];
    openDrawer(mission(), async (m) => {
      saved.push(m);
    });

    await pickVoiceover();

    await waitFor(() =>
      expect(saved.at(-1)?.voiceover).toEqual({
        kind: "file",
        file: "imported-1.ogg",
      }),
    );
  });

  it("is never deleted by the drawer itself", async () => {
    // Deleting before the write lands is what left a stored campaign naming a
    // file that had already gone (issue #2232). The page deletes what the
    // document stops naming, once it has landed.
    const saved: CampaignMission[] = [];
    openDrawer(
      mission({ voiceover: { kind: "file", file: "saved.ogg" } }),
      async (m) => {
        saved.push(m);
      },
    );

    await pickVoiceover();
    campaignMediaImport.mockResolvedValue({ file: "imported-2.ogg" });
    await pickVoiceover();
    await EXITS["the Close button"]();
    await drawerClosed();

    await tick();
    expect(campaignMediaDelete).not.toHaveBeenCalled();
    // Both imports and the file the campaign already had, all handed to the
    // page rather than deleted here.
    expect(saved.map((m) => m.voiceover)).toEqual([
      { kind: "file", file: "imported-1.ogg" },
      { kind: "file", file: "imported-2.ogg" },
    ]);
  });
});

describe("the four groups (issue #2261)", () => {
  /** The trigger for one group, whose accessible name carries its summary. */
  const header = (group: string) =>
    screen.getByRole("button", { name: new RegExp(`^${group}`) });

  it("opens the mission itself and starts the other three shut", () => {
    openDrawer(mission());

    expect(header("Content").getAttribute("data-state")).toBe("open");
    for (const group of ["Scenario", "Presentation", "Rules"]) {
      expect(header(group).getAttribute("data-state")).toBe("closed");
    }
    expect(screen.getByLabelText("Title")).toBeTruthy();
  });

  it("takes a shut group's fields out of the page rather than hiding them", () => {
    // Which is the whole point of shutting them: the media importers and the
    // unit picker each mount a unitsync scan, and a scan nobody asked for is
    // what makes opening this drawer cost tens of seconds (issue #2265).
    openDrawer(mission());

    expect(screen.queryByText("Briefing voiceover")).toBeNull();
    expect(screen.queryByText("Panorama")).toBeNull();
    expect(screen.queryByText("Unit restrictions")).toBeNull();

    expand("Presentation");

    expect(screen.getByText("Briefing voiceover")).toBeTruthy();
  });

  it("says what each shut group is holding when it is holding nothing", () => {
    openDrawer(mission());

    expect(header("Content").textContent).toContain(
      "No briefing, 0 objectives",
    );
    expect(header("Scenario").textContent).toContain("No scenario attached");
    expect(header("Presentation").textContent).toContain(
      "No panorama, side graphic, voiceover or cutscene",
    );
    expect(header("Rules").textContent).toContain("No restrictions");
  });

  it("says what each shut group is holding when something is set", () => {
    openDrawer(
      mission({
        briefing: "Hold the line",
        objectives: ["Survive"],
        voiceover: { kind: "file", file: "brief.ogg" },
        disabledUnits: ["armcom", "corcom"],
      }),
    );

    expect(header("Content").textContent).toContain(
      "Briefing written, 1 objective",
    );
    expect(header("Presentation").textContent).toContain("Voiceover");
    expect(header("Rules").textContent).toContain("2 units banned");
  });

  it("keeps the summary honest as the mission is edited", async () => {
    openDrawer(mission());

    screen.getByRole("button", { name: "Add objective" }).click();

    await waitFor(() =>
      expect(header("Content").textContent).toContain("1 objective"),
    );
  });

  it("saves a field in a group that was shut and then opened", async () => {
    const saved: CampaignMission[] = [];
    openDrawer(mission(), async (m) => {
      saved.push(m);
    });

    expand("Presentation");
    await pickVoiceover();

    await waitFor(() =>
      expect(saved.at(-1)?.voiceover).toEqual({
        kind: "file",
        file: "imported-1.ogg",
      }),
    );
  });

  it("still saves a field in a group that was shut and opened again", async () => {
    const saved: CampaignMission[] = [];
    openDrawer(mission(), async (m) => {
      saved.push(m);
    });

    // Content holds the text boxes, so shutting and reopening it is the way to
    // ask whether a remount costs the autosave path anything.
    header("Content").click();
    await waitFor(() => expect(screen.queryByLabelText("Subtitle")).toBeNull());
    expand("Content");

    fireEvent.blur(type("Subtitle", "Sector 9"));

    await waitFor(() => expect(saved.at(-1)?.subtitle).toBe("Sector 9"));
  });

  it("opens both when two are toggled in the same tick", () => {
    // Found in the running app: the setter built the next map from the render
    // it was created in, so two clicks React batched together left only the
    // second one open.
    openDrawer(mission());

    act(() => {
      header("Scenario").click();
      header("Rules").click();
    });

    expect(header("Scenario").getAttribute("data-state")).toBe("open");
    expect(header("Rules").getAttribute("data-state")).toBe("open");
  });

  it("remembers which groups were left open", async () => {
    openDrawer(mission());
    expand("Rules");
    await EXITS["the Close button"]();
    await drawerClosed();
    cleanup();

    openDrawer(mission());

    expect(header("Rules").getAttribute("data-state")).toBe("open");
  });

  it("says the game, the map and the facts whatever is shut", () => {
    // The two that decide whether the mission can be played at all live in
    // the snapshot, which no group holds, so the header carries them.
    openDrawer(
      mission({
        snapshot: { ...mission().snapshot, gameName: "Zero-K", mapName: "" },
      }),
    );

    expect(screen.getByText("Zero-K")).toBeTruthy();
    expect(screen.getByText("No map")).toBeTruthy();
    expect(screen.getByText("No briefing")).toBeTruthy();
  });
});

describe("a stale scenario, with the Scenario group shut (issue #2392)", () => {
  // The one fact a shut group used to hide. Every other summary says what is
  // set, which is what makes shutting a group safe. This one named the attached
  // scenario without saying the mission had stopped matching it, so an author
  // who never opened the group never found out.
  //
  // The answer is handed in rather than read here. Reading every stored
  // scenario means the content scan, 23 seconds on a cold archive cache, which
  // is the cost the shut groups exist to avoid (issue #2265). The campaign page
  // has already read them for its own mission rows.

  /** The scenario as the builder holds it, and the same one edited since. */
  const stored: Scenario = {
    ...newScenario("Beachhead"),
    id: "beachhead",
    updatedAt: "2026-03-03T09:00:00.000Z",
  };
  const editedSince: Scenario = {
    ...stored,
    updatedAt: "2026-05-14T09:00:00.000Z",
  };

  /** A mission playing a copy of `stored`. */
  const attached = () => attachScenario(mission(), stored);

  /** The trigger for one group, whose accessible name carries its summary. */
  const header = (group: string) =>
    screen.getByRole("button", { name: new RegExp(`^${group}`) });

  function renderPanelWith(m: CampaignMission, scenarios: Scenario[]) {
    return render(
      <DrawerProvider>
        <MissionEditorDrawer
          campaignId="c1"
          mission={m}
          scenarios={scenarios}
          onSave={async () => {}}
        />
      </DrawerProvider>,
    );
  }

  it("says so beside the heading, without opening the group", () => {
    renderPanelWith(attached(), [editedSince]);

    const scenario = header("Scenario");
    expect(scenario.getAttribute("data-state")).toBe("closed");
    expect(scenario.textContent).toContain("Out of date");
    expect(scenario.textContent).toContain(
      "The scenario has been edited since this copy was attached.",
    );
  });

  it("keeps saying what is attached as well as that it has moved on", () => {
    renderPanelWith(attached(), [editedSince]);

    expect(header("Scenario").textContent).toContain("Beachhead");
  });

  it("says nothing when the copy still matches", () => {
    renderPanelWith(attached(), [stored]);

    expect(header("Scenario").textContent).not.toContain("Out of date");
  });

  it("says nothing when no stored scenario has that id any more", () => {
    // Orphaned, not stale: there is nothing left to have fallen behind.
    renderPanelWith(attached(), []);

    expect(header("Scenario").textContent).not.toContain("Out of date");
  });

  it("says nothing when nobody handed the drawer a scenario list", () => {
    // No list is not an answer, so the marker is absent rather than guessed at.
    openDrawer(attached());

    expect(header("Scenario").textContent).not.toContain("Out of date");
  });

  it("clears once the mission's copy is brought up to date", () => {
    // Updating happens in the field inside the group, which hands the drawer a
    // new mission. The marker reads the mission as it stands, so it goes.
    const { rerender } = renderPanelWith(attached(), [editedSince]);
    expect(header("Scenario").textContent).toContain("Out of date");

    rerender(
      <DrawerProvider>
        <MissionEditorDrawer
          campaignId="c1"
          mission={attachScenario(mission(), editedSince)}
          scenarios={[editedSince]}
          onSave={async () => {}}
        />
      </DrawerProvider>,
    );

    expect(header("Scenario").textContent).not.toContain("Out of date");
  });

  it("leaves the other three headings unmarked", () => {
    renderPanelWith(attached(), [editedSince]);

    for (const group of ["Content", "Presentation", "Rules"]) {
      expect(header(group).textContent).not.toContain("Out of date");
    }
  });
});

describe("a refused save", () => {
  it("says so, keeps the drawer open, and keeps the edit on screen", async () => {
    openDrawer(mission(), async () => {
      throw new Error("disk full");
    });

    fireEvent.blur(type("Subtitle", "Sector 9"));

    await screen.findByText("disk full");
    expect(
      screen.getByText("Not saved. Leaving this page loses the change."),
    ).toBeTruthy();
    expect(screen.getByLabelText("Subtitle")).toHaveProperty(
      "value",
      "Sector 9",
    );
  });

  it("can be asked for again", async () => {
    const tries: CampaignMission[] = [];
    openDrawer(mission(), async (m) => {
      tries.push(m);
      if (tries.length === 1) throw new Error("disk full");
    });

    fireEvent.blur(type("Subtitle", "Sector 9"));
    await screen.findByText("disk full");

    screen.getByRole("button", { name: "Retry" }).click();

    await waitFor(() => expect(tries).toHaveLength(2));
    expect(tries.at(-1)?.subtitle).toBe("Sector 9");
    expect(screen.getByText(/^Saved /)).toBeTruthy();
  });
});
