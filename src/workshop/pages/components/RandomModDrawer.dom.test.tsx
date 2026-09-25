// @vitest-environment happy-dom
/**
 * The randomised mod drawer, driven under a real DOM (issue #1318).
 *
 * `randomMod.test.ts` covers the generator's own arithmetic and its
 * reproducibility. What is worth a DOM test here is the wiring: picking a
 * game reads its units, the preview reflects the rules on screen, and
 * pressing "Create project" hands the page a `NewProject` whose overrides
 * came from exactly what the preview showed.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameItem } from "@/content/bindings";

const GAME: GameItem = {
  name: "Test Game",
  primaryArchive: { name: "testgame.sdd", path: "/data/games/testgame.sdd" },
  dependencyArchives: [],
  info: {},
};

const UNITS: Record<string, Record<string, unknown>> = {
  armcom: { metalCost: 2000, health: 3400, speed: 45, buildTime: 12000 },
  armpw: { metalCost: 55, health: 220, speed: 90, buildTime: 900 },
};

vi.mock("../../config", () => ({
  useUnitDefs: () => ({
    defs: { units: UNITS, checksum: "abc123" },
    status: "ready",
    error: null,
    reload: () => {},
    loading: false,
  }),
}));

// A plain <select>, the same stand-in `UnitPage.dom.test.tsx` uses: the real
// picker is a Radix popover with pointer-capture behaviour happy-dom does not
// implement.
vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
    ariaLabel,
    placeholder,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: { value: string; label: string; disabled?: boolean }[];
    ariaLabel?: string;
    placeholder?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const { RandomModDrawer, RegenerateRandomModDrawer } = await import(
  "./RandomModDrawer"
);

afterEach(() => cleanup());

function openDrawer(
  projects: Parameters<typeof RandomModDrawer>[0]["projects"] = [],
) {
  const onStarted = vi.fn();
  render(
    <RandomModDrawer
      games={[GAME]}
      headers={new Map()}
      scanning={false}
      projects={projects}
      enginePath="/engines/105"
      dataDir="/data"
      onStarted={onStarted}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Randomise/ }));
  return onStarted;
}

function pickGame() {
  fireEvent.click(screen.getByLabelText("Game to randomise"));
  fireEvent.click(screen.getByRole("button", { name: GAME.name }));
}

describe("RandomModDrawer", () => {
  it("asks for a game before showing the rest of the form", () => {
    openDrawer();
    expect(screen.queryByLabelText("Seed")).toBeNull();
    pickGame();
    expect(screen.getByLabelText("Seed")).toBeTruthy();
  });

  it("shows every unit in scope by default, all fields on", () => {
    openDrawer();
    pickGame();
    expect(screen.getByText(/2 units in scope/)).toBeTruthy();
    expect(
      screen
        .getByRole("checkbox", { name: "Metal cost" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("turns a field off", () => {
    openDrawer();
    pickGame();
    fireEvent.click(screen.getByRole("checkbox", { name: "Metal cost" }));
    expect(
      screen
        .getByRole("checkbox", { name: "Metal cost" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("narrows the scope to a typed query", () => {
    openDrawer();
    pickGame();
    fireEvent.change(screen.getByLabelText("Scope"), {
      target: { value: "query" },
    });
    fireEvent.change(screen.getByLabelText("Search query"), {
      target: { value: "cost < 100" },
    });
    expect(screen.getByText(/1 unit in scope/)).toBeTruthy();
  });

  it("disables the create button once the scope matches nothing", () => {
    openDrawer();
    pickGame();
    fireEvent.change(screen.getByLabelText("Scope"), {
      target: { value: "query" },
    });
    fireEvent.change(screen.getByLabelText("Search query"), {
      target: { value: "cost > 999999" },
    });
    expect(screen.getByText(/0 units in scope/)).toBeTruthy();
    const button = screen.getByRole("button", {
      name: "Create project",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("offers a collection defined on an existing project against the same game", () => {
    const projects = [
      {
        id: "p1",
        name: "Slower tanks",
        gameName: GAME.name,
        edits: {
          overrides: {},
          clones: {},
          menus: {},
          text: {},
          disabled: [],
          collections: {
            cheap: { id: "cheap", name: "Cheap stuff", units: ["armpw"] },
          },
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      // biome-ignore lint/suspicious/noExplicitAny: test-only ModProject stub
    ] as any;
    openDrawer(projects);
    pickGame();
    fireEvent.change(screen.getByLabelText("Scope"), {
      target: { value: "collection" },
    });
    fireEvent.change(screen.getByLabelText("Collection"), {
      target: { value: "p1:cheap" },
    });
    expect(screen.getByText(/1 unit in scope/)).toBeTruthy();
  });

  it("starts a project named for the game and seed, with the rolled overrides", () => {
    const onStarted = openDrawer();
    pickGame();
    fireEvent.change(screen.getByLabelText("Seed"), {
      target: { value: "4242" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(onStarted).toHaveBeenCalledTimes(1);
    const input = onStarted.mock.calls[0][0];
    expect(input.name).toBe(`${GAME.name} random 4242`);
    expect(input.gameName).toBe(GAME.name);
    expect(input.authoredChecksum).toBe("abc123");
    expect(input.description).toContain("seed 4242");
    // Every unit in the fixture has a positive cost, health, speed and build
    // time, so with all four fields on and this seed at least one override
    // lands somewhere.
    expect(Object.keys(input.edits.overrides).length).toBeGreaterThan(0);
    // Issue #3090: what was just rolled is kept on the project as a recipe,
    // so "Regenerate" can reopen this same form from it.
    expect(input.randomModRecipe).toEqual({
      seed: 4242,
      scope: { kind: "all" },
      fields: expect.arrayContaining(["cost", "health", "speed", "buildtime"]),
      tierWeights: expect.any(Object),
    });
  });
});

const TIER_WEIGHTS = { common: 60, uncommon: 25, rare: 12, legendary: 3 };

/**
 * A project the generator already made, its recipe only rolling cost, with
 * one field (`buildTime`) overridden by hand after the fact - the recipe
 * never touches that field, so it is exactly what a regenerate must not
 * silently replace.
 */
function regeneratableProject() {
  return {
    id: "proj-1",
    name: "Test Game random 4242",
    gameName: GAME.name,
    edits: {
      overrides: { armcom: { buildTime: 99999 } },
      clones: {},
      menus: {},
      text: {},
      disabled: [],
    },
    randomModRecipe: {
      seed: 4242,
      scope: { kind: "all" },
      fields: ["cost"],
      tierWeights: TIER_WEIGHTS,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    // biome-ignore lint/suspicious/noExplicitAny: test-only ModProject stub
  } as any;
}

describe("RegenerateRandomModDrawer", () => {
  it("fixes the game to the project's own and prefills the recipe", () => {
    const project = regeneratableProject();
    render(
      <RegenerateRandomModDrawer
        open
        onOpenChange={() => {}}
        project={project}
        games={[GAME]}
        projects={[project]}
        enginePath="/engines/105"
        dataDir="/data"
        onRegenerate={() => {}}
      />,
    );

    expect(screen.queryByLabelText("Game to randomise")).toBeNull();
    expect(screen.getByText(GAME.name)).toBeTruthy();
    expect((screen.getByLabelText("Seed") as HTMLInputElement).value).toBe(
      "4242",
    );
    expect(
      screen
        .getByRole("checkbox", { name: "Metal cost" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("checkbox", { name: "Health" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeTruthy();
  });

  it("keeps a hand-edited field the recipe never wrote, on top of the new roll", () => {
    const project = regeneratableProject();
    const onRegenerate = vi.fn();
    render(
      <RegenerateRandomModDrawer
        open
        onOpenChange={() => {}}
        project={project}
        games={[GAME]}
        projects={[project]}
        enginePath="/engines/105"
        dataDir="/data"
        onRegenerate={onRegenerate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    expect(onRegenerate).toHaveBeenCalledTimes(1);
    const [overrides, recipe] = onRegenerate.mock.calls[0];
    expect(overrides.armcom.buildTime).toBe(99999);
    expect(recipe.fields).toEqual(["cost"]);
  });

  it("says how many hand-edited fields will be kept", () => {
    const project = regeneratableProject();
    render(
      <RegenerateRandomModDrawer
        open
        onOpenChange={() => {}}
        project={project}
        games={[GAME]}
        projects={[project]}
        enginePath="/engines/105"
        dataDir="/data"
        onRegenerate={() => {}}
      />,
    );

    expect(screen.getByText(/1 hand-edited field/)).toBeTruthy();
  });
});
