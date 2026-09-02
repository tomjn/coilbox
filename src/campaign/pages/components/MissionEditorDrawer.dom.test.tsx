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

/** Wait for the drawer to have gone, so its closing write has run. */
async function drawerClosed() {
  await waitFor(() =>
    expect(screen.queryByText("Briefing voiceover")).toBeNull(),
  );
}

/** Type into a labelled text box, without leaving it. */
function type(label: string, value: string) {
  const field = screen.getByLabelText(label);
  fireEvent.change(field, { target: { value } });
  return field;
}

/** Choose or replace one media slot, through the OS file dialog. */
async function pickMedia(label: string, choose: string) {
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
    expect(screen.getByText("Briefing voiceover")).toBeTruthy();
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
