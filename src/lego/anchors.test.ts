import { describe, expect, it } from "vitest";

import { addAnchor, removeAnchor, updateAnchor } from "./anchors";
import { subtreeAsCompound } from "./compounds";
import {
  type LegoPiece,
  type LegoProject,
  newProject,
  parseLegoProjectData,
} from "./model";

function project(): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-07-29T00:00:00Z",
  });
  return {
    ...base,
    pieces: [
      ...base.pieces,
      {
        id: "nose",
        name: "nose",
        parentId: "root",
        partId: "cone",
        position: [0, 1, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ],
  };
}

function pieceOf(doc: LegoProject, id: string): LegoPiece {
  return doc.pieces.find((piece) => piece.id === id) as LegoPiece;
}

describe("addAnchor with a facing", () => {
  it("stores the facing of the face that was clicked", () => {
    const doc = addAnchor(project(), "nose", [0, 0, 2], "a1", [0, 0, 1]);

    expect(pieceOf(doc, "nose").customAnchors).toEqual([
      { id: "a1", name: "anchor", position: [0, 0, 2], facing: [0, 0, 1] },
    ]);
  });

  it("reads a facing and up back from a saved unit, and none from an old one", () => {
    const doc = addAnchor(project(), "nose", [0, 0, 2], "a1", [0, 0, 1]);
    const withUp = updateAnchor(doc, "nose", "a1", { up: [1, 0, 0] });
    const saved = JSON.parse(JSON.stringify(withUp));
    saved.pieces[1].customAnchors.push({
      id: "old",
      name: "old",
      position: [0, 0, 1],
    });
    const read = parseLegoProjectData(saved);

    expect(read?.pieces[1].customAnchors).toEqual([
      {
        id: "a1",
        name: "anchor",
        position: [0, 0, 2],
        facing: [0, 0, 1],
        up: [1, 0, 0],
      },
      { id: "old", name: "old", position: [0, 0, 1] },
    ]);
  });
});

describe("addAnchor", () => {
  it("puts the anchor on the piece, where it was placed", () => {
    const doc = addAnchor(project(), "nose", [0, 0, 2], "a1");

    expect(pieceOf(doc, "nose").customAnchors).toEqual([
      { id: "a1", name: "anchor", position: [0, 0, 2] },
    ]);
  });

  it("names each one apart, so a list of three is readable", () => {
    let doc = addAnchor(project(), "nose", [0, 0, 2], "a1");
    doc = addAnchor(doc, "nose", [0, 0, 3], "a2");
    doc = addAnchor(doc, "nose", [0, 0, 4], "a3");

    expect(pieceOf(doc, "nose").customAnchors?.map((a) => a.name)).toEqual([
      "anchor",
      "anchor2",
      "anchor3",
    ]);
  });

  it("leaves every other piece alone", () => {
    const before = project();
    const doc = addAnchor(before, "nose", [0, 0, 2], "a1");

    expect(pieceOf(doc, "root")).toEqual(pieceOf(before, "root"));
  });

  it("does nothing for a piece that is not there", () => {
    const before = project();
    expect(addAnchor(before, "ghost", [0, 0, 2], "a1").pieces).toEqual(
      before.pieces,
    );
  });
});

describe("updateAnchor", () => {
  const doc = addAnchor(project(), "nose", [0, 0, 2], "a1");

  it("moves an anchor", () => {
    const moved = updateAnchor(doc, "nose", "a1", { position: [1, 1, 1] });

    expect(pieceOf(moved, "nose").customAnchors?.[0].position).toEqual([
      1, 1, 1,
    ]);
  });

  it("renames an anchor without moving it", () => {
    const named = updateAnchor(doc, "nose", "a1", { name: "muzzle" });
    const anchor = pieceOf(named, "nose").customAnchors?.[0];

    expect(anchor?.name).toBe("muzzle");
    expect(anchor?.position).toEqual([0, 0, 2]);
  });

  it("ignores an anchor that is not there", () => {
    expect(updateAnchor(doc, "nose", "gone", { name: "x" })).toEqual(doc);
  });
});

describe("removeAnchor", () => {
  it("takes the anchor off", () => {
    let doc = addAnchor(project(), "nose", [0, 0, 2], "a1");
    doc = addAnchor(doc, "nose", [0, 0, 3], "a2");

    const left = pieceOf(removeAnchor(doc, "nose", "a1"), "nose");
    expect(left.customAnchors?.map((a) => a.id)).toEqual(["a2"]);
  });

  it("drops the key with the last anchor, so the piece goes back to its box", () => {
    const doc = addAnchor(project(), "nose", [0, 0, 2], "a1");

    expect(pieceOf(removeAnchor(doc, "nose", "a1"), "nose")).not.toHaveProperty(
      "customAnchors",
    );
  });
});

describe("anchors and the rest of the document", () => {
  it("comes along when the piece is copied or duplicated", () => {
    const doc = addAnchor(project(), "nose", [0, 0, 2], "a1");

    // The one path behind copy, duplicate and save as a compound.
    const lifted = subtreeAsCompound(doc, "nose", {
      id: "c",
      now: "2026-07-29T00:00:00Z",
      newId: () => "new",
    }) as LegoProject;

    expect(lifted.pieces[0].customAnchors).toEqual([
      { id: "a1", name: "anchor", position: [0, 0, 2] },
    ]);
  });
});
