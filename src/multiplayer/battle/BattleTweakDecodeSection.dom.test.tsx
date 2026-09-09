// @vitest-environment happy-dom

/**
 * The entry point issue #2756 adds: decoding a battle's own tweak slots
 * without asking anyone to paste them anywhere (issue #1280 named this case
 * and left it for later). Three things worth a test of their own: nothing
 * renders for a battle with no tweak slot set, a change in the values a host
 * set triggers a fresh decode while an unrelated re-render does not, and
 * starting a project is a deliberate button rather than something the decode
 * itself does.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import type { DecodedTweakSet } from "@/workshop/decodeTweakSet";
import type { NewProject } from "@/workshop/project";
import { BattleTweakDecodeSection } from "./BattleTweakDecodeSection";

const { workshopDecodeTweakSet } = vi.hoisted(() => ({
  workshopDecodeTweakSet: vi.fn(),
}));
vi.mock("@/workshop/decodeTweakSet", async (orig) => ({
  ...(await orig<typeof import("@/workshop/decodeTweakSet")>()),
  workshopDecodeTweakSet,
}));

const { createProject } = vi.hoisted(() => ({
  createProject: vi.fn((_input: NewProject) => ({ id: "new-project-id" })),
}));
vi.mock("@/workshop/project", async (orig) => ({
  ...(await orig<typeof import("@/workshop/project")>()),
  useModProjects: () => ({ projects: [], createProject }),
}));

const SCHEMA: ConfigOption[] = [
  { key: "maxunits", name: "Max units", default: "1000", type: "number" },
  { key: "tweakdefs", name: "Tweak defs", default: "", type: "string" },
  { key: "tweakunits3", name: "Tweak units 3", default: "", type: "string" },
];

function draw(scriptTags: Record<string, string>) {
  return render(
    <MemoryRouter>
      <BattleTweakDecodeSection
        gameName="Beyond All Reason"
        modOptionsSchema={SCHEMA}
        scriptTags={scriptTags}
      />
    </MemoryRouter>,
  );
}

const dataTableSet: DecodedTweakSet = {
  tweakdefs: [
    {
      key: "tweakdefs",
      kind: "tweakdefs",
      slot: 0,
      lua: '{ ["armcom"] = { maxDamage = 9000 } }',
      manifest: null,
      form: "table",
      table: { armcom: { maxDamage: 9000 } },
      error: null,
    },
  ],
  tweakunits: [],
  unrecognised: [],
};

afterEach(() => {
  cleanup();
  workshopDecodeTweakSet.mockReset();
  createProject.mockClear();
});

describe("BattleTweakDecodeSection", () => {
  it("shows nothing for a battle that has set no tweak slot", () => {
    const { container } = draw({ "game/modoptions/maxunits": "2000" });
    expect(container.innerHTML).toBe("");
    expect(workshopDecodeTweakSet).not.toHaveBeenCalled();
  });

  it("shows nothing when every tweak slot still carries its empty default", () => {
    const { container } = draw({
      "game/modoptions/tweakdefs": "",
      "game/modoptions/tweakunits3": "",
    });
    expect(container.innerHTML).toBe("");
    expect(workshopDecodeTweakSet).not.toHaveBeenCalled();
  });

  it("decodes on its own once a tweak slot is set, without a paste", async () => {
    workshopDecodeTweakSet.mockResolvedValueOnce(dataTableSet);
    draw({ "game/modoptions/tweakdefs": "QUJD" });

    await screen.findByText("Data table");
    expect(workshopDecodeTweakSet).toHaveBeenCalledWith({
      entries: { tweakdefs: "QUJD" },
    });
    expect(workshopDecodeTweakSet).toHaveBeenCalledTimes(1);
  });

  it("does not redecode when a re-render carries the same tweak values", async () => {
    workshopDecodeTweakSet.mockResolvedValueOnce(dataTableSet);
    const { rerender } = render(
      <MemoryRouter>
        <BattleTweakDecodeSection
          gameName="Beyond All Reason"
          modOptionsSchema={SCHEMA}
          scriptTags={{ "game/modoptions/tweakdefs": "QUJD" }}
        />
      </MemoryRouter>,
    );
    await screen.findByText("Data table");

    // A fresh object, same values: the kind of update a busy battle room
    // sends on every unrelated chat line or member change.
    rerender(
      <MemoryRouter>
        <BattleTweakDecodeSection
          gameName="Beyond All Reason"
          modOptionsSchema={SCHEMA}
          scriptTags={{ "game/modoptions/tweakdefs": "QUJD" }}
        />
      </MemoryRouter>,
    );

    expect(workshopDecodeTweakSet).toHaveBeenCalledTimes(1);
  });

  it("offers starting a project only as a deliberate button, never on its own", async () => {
    workshopDecodeTweakSet.mockResolvedValueOnce(dataTableSet);
    draw({ "game/modoptions/tweakdefs": "QUJD" });

    await screen.findByText("Data table");
    expect(createProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Start a project from this"));

    expect(createProject).toHaveBeenCalledTimes(1);
    const input = createProject.mock.calls[0][0];
    expect(input.gameName).toBe("Beyond All Reason");
    expect(input.edits?.clones?.armcom).toEqual({
      key: "armcom",
      replacesGameUnit: false,
      def: { maxDamage: 9000 },
    });
  });
});
