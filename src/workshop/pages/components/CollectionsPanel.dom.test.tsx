// @vitest-environment happy-dom
/**
 * The Collections section that creates, nests, renames and deletes collections, and edits
 * one collection's own membership (issue #2654). Exercised against the pure
 * functions in `collections.ts` rather than mocked, so a create-then-nest
 * flow proves the whole round trip the way a person would drive it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { UnitClones } from "../../clones";
import {
  type Collection,
  type Collections,
  createCollection,
  importCollection,
  removeCollection,
  renameCollection,
  setCollectionMembership,
  setCollectionParent,
  setCollectionRule,
} from "../../collections";
import type { EquippedWeapons, WeaponLibrary } from "../../weaponLibrary";
import { CollectionsPanel, type ImportableProject } from "./CollectionsPanel";

const UNITS = {
  armcom: {},
  armflash: {},
  armpw: {},
};

function draw(
  collections: Collections = {},
  units: Record<string, Record<string, unknown>> = UNITS,
  weapons: {
    weaponDefs?: Record<string, Record<string, unknown>>;
    library?: WeaponLibrary;
    equipped?: EquippedWeapons;
    clones?: UnitClones;
  } = {},
  otherProjects: ImportableProject[] = [],
) {
  const weaponDefs = weapons.weaponDefs ?? {};
  const library = weapons.library ?? {};
  const equipped = weapons.equipped ?? {};
  const clones = weapons.clones ?? {};
  let current = collections;
  const onImport = (source: Collection) => {
    const result = importCollection(
      current,
      source,
      new Set(Object.keys(units)),
    );
    current = result.collections;
    rerender();
    return { name: result.name, droppedUnits: result.droppedUnits };
  };
  const onCreate = (name: string, parentId: string | undefined) => {
    current = createCollection(current, name, parentId).collections;
    rerender();
  };
  const onRename = (id: string, name: string) => {
    current = renameCollection(current, id, name);
    rerender();
  };
  const onDelete = (id: string) => {
    current = removeCollection(current, id);
    rerender();
  };
  const onSetParent = (id: string, parentId: string | undefined) => {
    current = setCollectionParent(current, id, parentId);
    rerender();
  };
  const onToggleMember = (id: string, unit: string, member: boolean) => {
    current = setCollectionMembership(current, id, unit, member);
    rerender();
  };
  const onSetRule = (id: string, rule: string) => {
    current = setCollectionRule(current, id, rule);
    rerender();
  };

  const view = render(
    <CollectionsPanel
      collections={current}
      units={units}
      overrides={{}}
      nameOf={(key) => `Unit ${key}`}
      weaponDefs={weaponDefs}
      library={library}
      equipped={equipped}
      clones={clones}
      onCreate={onCreate}
      onRename={onRename}
      onDelete={onDelete}
      onSetParent={onSetParent}
      onToggleMember={onToggleMember}
      onSetRule={onSetRule}
      otherProjects={otherProjects}
      onImport={onImport}
    />,
  );
  function rerender() {
    view.rerender(
      <CollectionsPanel
        collections={current}
        units={units}
        overrides={{}}
        nameOf={(key) => `Unit ${key}`}
        weaponDefs={weaponDefs}
        library={library}
        equipped={equipped}
        clones={clones}
        onCreate={onCreate}
        onRename={onRename}
        onDelete={onDelete}
        onSetParent={onSetParent}
        onToggleMember={onToggleMember}
        onSetRule={onSetRule}
        otherProjects={otherProjects}
        onImport={onImport}
      />,
    );
  }
  return {
    ...view,
    get collections() {
      return current;
    },
  };
}

afterEach(cleanup);

describe("creating a collection", () => {
  it("adds it to the tree", () => {
    draw();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Tier two" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(screen.getByRole("button", { name: /^tier two/i })).toBeTruthy();
  });

  it("does nothing for a blank name", () => {
    const view = draw();
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(Object.keys(view.collections)).toHaveLength(0);
  });
});

describe("editing membership", () => {
  it("adds a unit when its checkbox is ticked, and shows the new count", () => {
    const { collections, id } = createCollection({}, "Bots");
    const view = draw(collections);
    fireEvent.click(screen.getByRole("button", { name: /^bots/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /armcom/i }));
    expect(view.collections[id].units).toEqual(["armcom"]);
    expect(
      screen.getByRole("heading", { name: /units in bots/i }).textContent,
    ).toContain("1");
  });

  it("narrows the checklist with the search box", () => {
    const { collections } = createCollection({}, "Bots");
    draw(collections);
    fireEvent.click(screen.getByRole("button", { name: /^bots/i }));
    fireEvent.change(screen.getByPlaceholderText("Find a unit"), {
      target: { value: "flash" },
    });
    expect(screen.getByText("armflash")).toBeTruthy();
    expect(screen.queryByText("armcom")).toBeNull();
  });
});

describe("nesting", () => {
  it("indents a child under its parent in the tree", () => {
    const top = createCollection({}, "Tier two");
    const { collections } = createCollection(top.collections, "Bots", top.id);
    draw(collections);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0].textContent).toContain("Tier two");
    expect(rows[1].textContent).toContain("Bots");
    // The child's row is indented further than its parent's.
    const parentPad = Number.parseFloat(rows[0].style.paddingLeft);
    const childPad = Number.parseFloat(rows[1].style.paddingLeft);
    expect(childPad).toBeGreaterThan(parentPad);
  });
});

describe("rule-based membership (issue #2656)", () => {
  const UNITS_WITH_COST = {
    armcom: { metalCost: 900 },
    armflash: { metalCost: 50 },
    armpw: { metalCost: 30 },
  };

  it("counts every unit the rule matches, on top of the explicit list", () => {
    const { collections } = createCollection({}, "Cheap");
    draw(collections, UNITS_WITH_COST);
    fireEvent.click(screen.getByRole("button", { name: /^cheap/i }));
    fireEvent.change(screen.getByPlaceholderText("e.g. cost < 200"), {
      target: { value: "cost < 200" },
    });
    expect(
      screen.getByRole("heading", { name: /units in cheap/i }).textContent,
    ).toContain("2");
  });

  it("shows the rule's own parse error inline", () => {
    const { collections } = createCollection({}, "Broken");
    draw(collections, UNITS_WITH_COST);
    fireEvent.click(screen.getByRole("button", { name: /^broken/i }));
    fireEvent.change(screen.getByPlaceholderText("e.g. cost < 200"), {
      target: { value: "cost >" },
    });
    expect(screen.getByText(/needs a value/)).toBeTruthy();
  });

  it("counts a unit a dps rule matches (issue #3085)", () => {
    const tank = {
      metalCost: 200,
      weapons: [{ name: "armtank_laser" }],
      weapondefs: {
        laser: { range: 300, reloadTime: 2, damage: { default: 50 } },
      },
    };
    const { collections } = createCollection({}, "Hard hitters");
    draw(collections, { armtank: tank });
    fireEvent.click(screen.getByRole("button", { name: /^hard hitters/i }));
    fireEvent.change(screen.getByPlaceholderText("e.g. cost < 200"), {
      target: { value: "dps > 20" },
    });
    expect(
      screen.getByRole("heading", { name: /units in hard hitters/i })
        .textContent,
    ).toContain("1");
  });
});

describe("adding from another project (issue #3108)", () => {
  function otherProject(
    name: string,
    collections: Collection[],
  ): ImportableProject {
    return { id: name, name, collections };
  }

  /** Opens a Radix `OptionSelect` by its label and picks the named option, the
   *  way `fireEvent.change` cannot: the panel is not inside a `<form>`, so the
   *  hidden native select Radix mirrors state onto for form submission does
   *  not render, and there is nothing for `fireEvent.change` to fire at. */
  function pickOption(label: string, option: string) {
    fireEvent.click(screen.getByLabelText(label));
    fireEvent.click(screen.getByRole("option", { name: option }));
  }

  it("hides the section when there is nothing to offer", () => {
    draw();
    expect(screen.queryByText("Add from another project")).toBeNull();
  });

  it("copies a hand-picked collection's units, dropping any this game lacks", () => {
    const { collections: source, id } = createCollection({}, "Tier two");
    const withMembers = setCollectionMembership(source, id, "armcom", true);
    const both = setCollectionMembership(withMembers, id, "armpw", true);
    const view = draw({}, UNITS, {}, [
      otherProject("Other project", [both[id]]),
    ]);

    pickOption("Project to add a collection from", "Other project");
    pickOption("Collection to add", "Tier two");
    fireEvent.click(screen.getByRole("button", { name: /add collection/i }));

    const [newId] = Object.keys(view.collections);
    expect(view.collections[newId].name).toBe("Tier two");
    expect(view.collections[newId].units).toEqual(["armcom", "armpw"]);
    expect(screen.getByText(/Added "Tier two"/)).toBeTruthy();
  });

  it("drops a unit the current game does not have, and says which", () => {
    const { collections: source, id } = createCollection({}, "Tier two");
    const withMember = setCollectionMembership(source, id, "armsolar", true);
    const view = draw({}, UNITS, {}, [
      otherProject("Other project", [withMember[id]]),
    ]);

    pickOption("Project to add a collection from", "Other project");
    pickOption("Collection to add", "Tier two");
    fireEvent.click(screen.getByRole("button", { name: /add collection/i }));

    const [newId] = Object.keys(view.collections);
    expect(view.collections[newId].units).toEqual([]);
    expect(screen.getByText(/armsolar/)).toBeTruthy();
  });

  it("copies a rule verbatim", () => {
    const { collections: created, id } = createCollection({}, "Cheap");
    const withRule = setCollectionRule(created, id, "cost < 200");
    const view = draw({}, UNITS, {}, [
      otherProject("Other project", [withRule[id]]),
    ]);

    pickOption("Project to add a collection from", "Other project");
    pickOption("Collection to add", "Cheap");
    fireEvent.click(screen.getByRole("button", { name: /add collection/i }));

    const [newId] = Object.keys(view.collections);
    expect(view.collections[newId].rule).toBe("cost < 200");
  });

  it("numbers the copy when the name is already used in this project", () => {
    const { collections: existing } = createCollection({}, "Tier two");
    const { collections: source, id } = createCollection({}, "Tier two");
    const view = draw(existing, UNITS, {}, [
      otherProject("Other project", [source[id]]),
    ]);

    pickOption("Project to add a collection from", "Other project");
    pickOption("Collection to add", "Tier two");
    fireEvent.click(screen.getByRole("button", { name: /add collection/i }));

    const names = Object.values(view.collections).map((c) => c.name);
    expect(names).toContain("Tier two 2");
    expect(screen.getByText(/Added "Tier two 2"/)).toBeTruthy();
  });
});

describe("deleting", () => {
  it("re-parents children rather than removing them", () => {
    const top = createCollection({}, "Tier two");
    const mid = createCollection(top.collections, "Bots", top.id);
    const view = draw(mid.collections);
    fireEvent.click(screen.getByRole("button", { name: /delete tier two/i }));
    expect(view.collections[top.id]).toBeUndefined();
    expect(view.collections[mid.id].parentId).toBeUndefined();
    expect(screen.getByRole("button", { name: /^bots/i })).toBeTruthy();
  });
});
