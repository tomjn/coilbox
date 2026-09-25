// @vitest-environment happy-dom
/**
 * The drawer that creates, nests, renames and deletes collections, and edits
 * one collection's own membership (issue #2654). Exercised against the pure
 * functions in `collections.ts` rather than mocked, so a create-then-nest
 * flow proves the whole round trip the way a person would drive it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Collections,
  createCollection,
  removeCollection,
  renameCollection,
  setCollectionMembership,
  setCollectionParent,
} from "../../collections";
import { CollectionsDrawer } from "./CollectionsDrawer";

const UNITS = {
  armcom: {},
  armflash: {},
  armpw: {},
};

function draw(collections: Collections = {}) {
  let current = collections;
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

  const view = render(
    <CollectionsDrawer
      open
      onOpenChange={() => {}}
      collections={current}
      units={UNITS}
      nameOf={(key) => `Unit ${key}`}
      onCreate={onCreate}
      onRename={onRename}
      onDelete={onDelete}
      onSetParent={onSetParent}
      onToggleMember={onToggleMember}
    />,
  );
  function rerender() {
    view.rerender(
      <CollectionsDrawer
        open
        onOpenChange={() => {}}
        collections={current}
        units={UNITS}
        nameOf={(key) => `Unit ${key}`}
        onCreate={onCreate}
        onRename={onRename}
        onDelete={onDelete}
        onSetParent={onSetParent}
        onToggleMember={onToggleMember}
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
