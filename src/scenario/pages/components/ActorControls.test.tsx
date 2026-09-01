// @vitest-environment happy-dom
/**
 * An actor's two overrides against a document that changes underneath them
 * (issue #2185).
 *
 * The same drift `panels.test.tsx` pins for the panel fields, in the health
 * slider and the display name box. Each keeps its own copy so the editor is not
 * writing a file per dragged frame or per keystroke, an undo puts the document
 * back without touching either, and the next nudge or keystroke commits the copy
 * and takes the undo with it.
 *
 * Neither holds the field the document holds. Health is a percentage of a
 * fraction, and 100% is the absence of an override rather than a stored 1. The
 * display name is a string that is dropped when it is blank. So what each has to
 * follow is what it shows, not what is written down.
 *
 * The bar is mounted keyed by the actor's id, so moving the selection reseeds
 * both and this only shows with the same actor still selected.
 *
 * Their commit rules are pinned alongside, because the resync must not quietly
 * change them: the health floor is what stops a unit spawning dead, the name is
 * trimmed on the way in, and neither override may take the other one out.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ActorState, ScenarioActor } from "../../model";
import { ActorControls } from "./ActorControls";
import { MIN_ACTOR_HP, normaliseActorState } from "./editing";
import {
  type EditHistory,
  emptyHistory,
  recordEdit,
  undoEdit,
} from "./history";

afterEach(cleanup);

function actor(state?: ActorState): ScenarioActor {
  return {
    id: "hero",
    unitDef: "armcom",
    team: "t1",
    pos: { x: 100, z: 100 },
    facing: 0,
    state,
  };
}

/** The selection bar in miniature: one actor, the real undo stack, and an Undo
 *  button standing in for the shortcut. */
function ActorHarness({ initial }: { initial?: ActorState }) {
  const [document, setDocument] = useState(() => actor(initial));
  const [history, setHistory] =
    useState<EditHistory<ScenarioActor>>(emptyHistory);

  const edit = (next: ScenarioActor) => {
    setHistory(recordEdit(history, document, next));
    setDocument(next);
  };

  return (
    <>
      <ActorControls
        actor={document}
        participants={[]}
        onEdit={(patch) => edit({ ...document, ...patch })}
        // What `setActorState` does with what the bar hands it.
        onState={(state) =>
          edit({ ...document, state: normaliseActorState(state) })
        }
      />
      <button
        type="button"
        onClick={() => {
          const step = undoEdit(history, document);
          if (!step) return;
          setHistory(step.history);
          setDocument(step.document);
        }}
      >
        Undo
      </button>
      <output>{JSON.stringify(document.state ?? null)}</output>
    </>
  );
}

/** The overrides start behind a popover, the way they do on the map. */
function openDetails(initial?: ActorState) {
  render(<ActorHarness initial={initial} />);
  fireEvent.click(screen.getByRole("button", { name: /Details/ }));
}

function asInput(field: HTMLElement): HTMLInputElement {
  return field as HTMLInputElement;
}

/** The overrides the document holds, which the harness puts on screen so a test
 *  can read them the way the runtime would. */
const stored = (): ActorState | null =>
  JSON.parse(screen.getByRole("status").textContent ?? "null");

const undo = () =>
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));

const nameBox = () => screen.getByLabelText("Display name");
const thumb = () => screen.getByRole("slider");

/** One notch up the slider, which both moves it and writes the move. */
function nudgeHealth() {
  fireEvent.keyDown(thumb(), { key: "ArrowRight" });
}

/** The percentage the slider is showing, which is also what its label says. */
const shownHealth = () => thumb().getAttribute("aria-valuenow");

function commit(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

describe("an actor's starting health when the document moves under it", () => {
  it("shows the health an undo put back", () => {
    openDetails({ hp: 0.5 });

    nudgeHealth();
    undo();

    expect(shownHealth()).toBe("50");
    expect(screen.getByText("Starting health: 50%")).toBeTruthy();
  });

  it("does not write the undone health back on the next nudge", () => {
    openDetails({ hp: 0.5 });

    nudgeHealth();
    undo();
    nudgeHealth();

    expect(stored()?.hp).toBeCloseTo(0.51, 5);
  });

  it("shows full health again when an undo takes the override away", () => {
    openDetails();

    // Down from 100, since there is nowhere above it to go.
    fireEvent.keyDown(thumb(), { key: "ArrowLeft" });
    undo();

    expect(shownHealth()).toBe("100");
    expect(stored()).toBeNull();
  });
});

describe("an actor's starting health commit rules", () => {
  it("stops at the floor that keeps a unit from spawning dead", () => {
    openDetails({ hp: MIN_ACTOR_HP });

    fireEvent.keyDown(thumb(), { key: "ArrowLeft" });

    expect(shownHealth()).toBe(String(MIN_ACTOR_HP * 100));
    expect(stored()?.hp).toBeCloseTo(MIN_ACTOR_HP, 5);
  });

  it("leaves the actor's other overrides alone", () => {
    openDetails({ hp: 0.5, invulnerable: true, name: "Rook" });

    nudgeHealth();

    expect(stored()).toEqual({ hp: 0.51, invulnerable: true, name: "Rook" });
  });
});

describe("an actor's display name when the document moves under it", () => {
  it("shows the name an undo put back", () => {
    openDetails({ name: "Rook" });

    commit(nameBox(), "Bishop");
    undo();

    expect(asInput(nameBox()).value).toBe("Rook");
  });

  it("does not write the undone name back on the next keystroke", () => {
    openDetails({ name: "Rook" });

    commit(nameBox(), "Bishop");
    undo();
    commit(nameBox(), `${asInput(nameBox()).value}!`);

    expect(stored()?.name).toBe("Rook!");
  });

  it("empties the box again when an undo takes the name away", () => {
    openDetails();

    commit(nameBox(), "Rook");
    undo();

    expect(asInput(nameBox()).value).toBe("");
    expect(stored()).toBeNull();
  });
});

describe("an actor's display name commit rules", () => {
  it("is trimmed on the way in", () => {
    openDetails({ name: "Rook" });

    commit(nameBox(), "  Bishop  ");

    expect(stored()?.name).toBe("Bishop");
  });

  it("clears the name when the box is emptied", () => {
    openDetails({ name: "Rook", invulnerable: true });

    commit(nameBox(), "");

    expect(stored()).toEqual({ invulnerable: true });
  });

  it("leaves the actor's other overrides alone", () => {
    openDetails({ hp: 0.5, invulnerable: true });

    commit(nameBox(), "Rook");

    expect(stored()).toEqual({ hp: 0.5, invulnerable: true, name: "Rook" });
  });
});
