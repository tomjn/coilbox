// @vitest-environment happy-dom

/**
 * When the builder writes a unit, and when it photographs one (issue #586).
 *
 * `./document.test.ts` covers the reducer: what an edit, an undo and a selection
 * do to the document. This is the layer above it, which the reducer says nothing
 * about: the autosave timer, the save on the way out, and the thumbnail.
 *
 * The thumbnail is the reason this file exists. A WebGL canvas throws its drawing
 * buffer away the moment the frame is composited, so a picture taken at any time
 * other than immediately after a draw is blank. What keeps that honest is that
 * the viewport hands over a function rather than a canvas, and the hook calls it
 * at the moment it wants a picture. Held wrong, nothing here throws and nothing
 * looks broken: the overview just fills up with blank squares.
 *
 * There is no WebGL here. The capture answers a plain canvas, which is enough to
 * say when it was asked and what was done with the answer.
 */

import { render } from "@testing-library/react";
import { act, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type LegoProject, newProject } from "./model";

const saveProject = vi.fn(async (project: LegoProject) => project);
const saveThumbnail = vi.fn(
  async (_id: string, _canvas: HTMLCanvasElement) => {},
);
const hasThumbnail = vi.fn(async (_id: string) => false);
/** What the shared store is holding, which is where the hook reads the unit. */
let stored: LegoProject[] = [];

vi.mock("./projects", () => ({
  saveProject: (project: LegoProject) => saveProject(project),
  saveThumbnail: (id: string, canvas: HTMLCanvasElement) =>
    saveThumbnail(id, canvas),
  hasThumbnail: (id: string) => hasThumbnail(id),
  useLegoProjects: () => ({ projects: stored, loading: false, error: null }),
}));

import { type LegoDocumentSession, useLegoDocument } from "./useLegoDocument";

function walker(): LegoProject {
  return newProject({
    id: "walker",
    rootPieceId: "base",
    name: "walker",
    packId: "lego",
    packVersion: "1",
    now: "2026-08-21T00:00:00Z",
  });
}

/**
 * The session, and a capture registered the way the viewport registers one:
 * from an effect, once the scene is up.
 */
function open(capture?: () => HTMLCanvasElement | null): {
  doc: () => LegoDocumentSession;
  unmount: () => void;
} {
  let latest: LegoDocumentSession | null = null;
  function Harness() {
    const doc = useLegoDocument("walker");
    latest = doc;
    const onCapture = doc.onCapture;
    useEffect(() => {
      if (capture) onCapture(capture);
    }, [onCapture]);
    return null;
  }
  const view = render(<Harness />);
  return {
    doc: () => {
      if (!latest) throw new Error("the hook never ran");
      return latest;
    },
    unmount: view.unmount,
  };
}

/** A distinct canvas per call, so which one was written is answerable. */
function frames(): {
  next: () => HTMLCanvasElement;
  taken: HTMLCanvasElement[];
} {
  const taken: HTMLCanvasElement[] = [];
  return {
    next: () => {
      const canvas = document.createElement("canvas");
      canvas.dataset.frame = String(taken.length);
      taken.push(canvas);
      return canvas;
    },
    taken,
  };
}

/** Let the autosave timer fire and its promise settle. */
async function autosave() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  saveProject.mockClear();
  saveThumbnail.mockClear();
  hasThumbnail.mockClear();
  hasThumbnail.mockResolvedValue(false);
  stored = [walker()];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("opening a unit", () => {
  it("hands over the stored unit once the store has it", () => {
    const session = open();
    expect(session.doc().project?.name).toBe("walker");
    expect(session.doc().loading).toBe(false);
  });

  it("has nothing to undo, redo or save yet", () => {
    const session = open();
    const doc = session.doc();
    expect([doc.canUndo, doc.canRedo, doc.dirty]).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("the autosave", () => {
  it("writes shortly after an edit rather than on the edit", async () => {
    const session = open();
    act(() => {
      session.doc().edit((project) => ({ ...project, name: "spider" }));
    });
    expect(saveProject).not.toHaveBeenCalled();

    await autosave();
    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(saveProject.mock.calls[0][0].name).toBe("spider");
  });

  /** A drag is a hundred edits and should not be a hundred disk writes. */
  it("folds a run of edits into one write", async () => {
    const session = open();
    for (const name of ["a", "b", "c"]) {
      act(() => {
        session.doc().edit((project) => ({ ...project, name }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    expect(saveProject).not.toHaveBeenCalled();

    await autosave();
    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(saveProject.mock.calls[0][0].name).toBe("c");
  });

  it("stops being dirty once the write lands", async () => {
    const session = open();
    act(() => {
      session.doc().edit((project) => ({ ...project, name: "spider" }));
    });
    expect(session.doc().dirty).toBe(true);
    await autosave();
    expect(session.doc().dirty).toBe(false);
  });

  /** Leaving before the timer fires still writes, or the last edit is lost. */
  it("writes on the way out when there is work the timer never got to", async () => {
    const session = open();
    act(() => {
      session.doc().edit((project) => ({ ...project, name: "spider" }));
    });
    act(() => session.unmount());
    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(saveProject.mock.calls[0][0].name).toBe("spider");
  });

  it("writes nothing on the way out when there is nothing owing", async () => {
    const session = open();
    act(() => {
      session.doc().edit((project) => ({ ...project, name: "spider" }));
    });
    await autosave();
    saveProject.mockClear();
    act(() => session.unmount());
    expect(saveProject).not.toHaveBeenCalled();
  });
});

describe("undo and redo", () => {
  it("walks back and forward through the edits", async () => {
    const session = open();
    act(() => {
      session.doc().edit((project) => ({ ...project, name: "spider" }));
    });
    expect(session.doc().canUndo).toBe(true);

    act(() => session.doc().undo());
    expect(session.doc().project?.name).toBe("walker");
    expect(session.doc().canRedo).toBe(true);

    act(() => session.doc().redo());
    expect(session.doc().project?.name).toBe("spider");
  });

  /** An undo leaves the document not matching the disk, so it saves like an
   *  edit does rather than sitting there undone and unwritten. */
  it("writes what an undo left behind", async () => {
    const session = open();
    act(() => {
      session.doc().edit((project) => ({ ...project, name: "spider" }));
    });
    await autosave();
    saveProject.mockClear();

    act(() => session.doc().undo());
    await autosave();
    expect(saveProject.mock.calls[0][0].name).toBe("walker");
  });
});

describe("the thumbnail a save takes", () => {
  // The unit already has a picture, so the first-look capture below stays out
  // of the way and every frame taken here belongs to a save.
  beforeEach(() => {
    hasThumbnail.mockResolvedValue(true);
  });

  /**
   * The whole point. The viewport draws a frame and copies it inside the
   * capture, so the hook has to call it at the moment it wants a picture. A
   * canvas taken any earlier and held reads blank by the time it is written.
   */
  it("asks the viewport for a picture at the moment it saves, not before", async () => {
    const film = frames();
    const session = open(film.next);
    expect(film.taken).toHaveLength(0);

    act(() => {
      session.doc().edit((project) => ({ ...project, name: "spider" }));
    });
    await autosave();

    expect(film.taken).toHaveLength(1);
    expect(saveThumbnail).toHaveBeenCalledWith("walker", film.taken[0]);
  });

  it("takes a fresh picture for every save rather than reusing the first", async () => {
    const film = frames();
    const session = open(film.next);
    for (const name of ["a", "b"]) {
      act(() => {
        session.doc().edit((project) => ({ ...project, name }));
      });
      await autosave();
    }

    expect(film.taken).toHaveLength(2);
    expect(saveThumbnail.mock.calls.map((call) => call[1])).toEqual(film.taken);
  });

  /** Nothing drawable yet: an empty unit, or a texture still coming off disk.
   *  No picture is better than a black square. */
  it("writes nothing when there is nothing to photograph", async () => {
    const session = open(() => null);
    act(() => {
      session.doc().edit((project) => ({ ...project, name: "spider" }));
    });
    await autosave();

    expect(saveProject).toHaveBeenCalledTimes(1);
    expect(saveThumbnail).not.toHaveBeenCalled();
  });

  it("photographs the unit under the id the write came back with", async () => {
    saveProject.mockImplementationOnce(async (project) => ({
      ...project,
      id: "written",
    }));
    const film = frames();
    const session = open(film.next);
    act(() => {
      session.doc().edit((project) => ({ ...project, name: "spider" }));
    });
    await autosave();

    expect(saveThumbnail).toHaveBeenCalledWith("written", film.taken[0]);
  });
});

describe("the first picture of a unit that arrived from outside the builder", () => {
  /** An imported unit never went near the viewport, so it has no picture until
   *  somebody opens it. Opening is reason enough to take one. */
  it("photographs a unit that has none, without an edit", async () => {
    const film = frames();
    open(film.next);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(saveThumbnail).toHaveBeenCalledWith("walker", film.taken[0]);
    expect(saveProject).not.toHaveBeenCalled();
  });

  it("leaves a unit that already has one alone", async () => {
    hasThumbnail.mockResolvedValue(true);
    const film = frames();
    open(film.next);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(film.taken).toHaveLength(0);
    expect(saveThumbnail).not.toHaveBeenCalled();
  });

  /** A big model's texture can be seconds off disk, and the capture answers
   *  null until the unit is drawable. So it asks again. */
  it("keeps asking until the unit is drawable, then writes once", async () => {
    const film = frames();
    let asked = 0;
    open(() => {
      asked += 1;
      return asked < 3 ? null : film.next();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(asked).toBe(3);
    expect(saveThumbnail).toHaveBeenCalledTimes(1);
    expect(saveThumbnail).toHaveBeenCalledWith("walker", film.taken[0]);
  });

  /** A unit with nothing in it never becomes drawable. It gives up rather than
   *  polling for the rest of the session. */
  it("gives up on a unit that never becomes drawable", async () => {
    let asked = 0;
    open(() => {
      asked += 1;
      return null;
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    const settled = asked;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(asked).toBe(settled);
    expect(saveThumbnail).not.toHaveBeenCalled();
  });
});
