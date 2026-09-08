// @vitest-environment happy-dom
/**
 * What the drawer says about a compile (issue #1275).
 *
 * The Lua itself is checked in Rust, where it is generated and where a test can
 * run it. What is left here is the part the compiler cannot check for itself:
 * that a note the compiler raised reaches the person reading the output, and
 * that the choice between the two forms is on screen beside its reason rather
 * than left for them to infer from the Lua.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CompiledMod, CompileState } from "../../compile";
import type { ModProject } from "../../project";
import { CompiledLuaDrawer } from "./CompiledLuaDrawer";

const project: ModProject = {
  id: "p1",
  name: "Faster commanders",
  gameName: "Balanced Annihilation V15.9.8",
  edits: { overrides: {}, clones: {}, menus: {}, text: {}, disabled: [] },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const compiled = (over: Partial<CompiledMod> = {}): CompileState => ({
  compiled: { chunks: [], files: [], notes: [], ...over },
  loading: false,
  error: null,
});

const draw = (state: CompileState) =>
  render(
    <CompiledLuaDrawer
      open
      onOpenChange={() => {}}
      project={project}
      state={state}
    />,
  );

afterEach(cleanup);

describe("the generated Lua drawer", () => {
  it("says which form each change took and why", () => {
    draw(
      compiled({
        chunks: [
          {
            form: "block",
            title: "armlab build menu",
            reason: "Replayed over the list the game ships.",
            lua: "do end",
          },
        ],
      }),
    );
    expect(screen.getByText("do ... end")).toBeTruthy();
    expect(screen.getByText("armlab build menu")).toBeTruthy();
    expect(
      screen.getByText("Replayed over the list the game ships."),
    ).toBeTruthy();
  });

  /** A note is the compiler saying what it could not do. Burying it under the
   *  Lua would leave someone reading a file that is missing their rename. */
  it("shows a note the compiler raised", () => {
    draw(compiled({ notes: ["Two name edits are not compiled."] }));
    expect(screen.getByText("Two name edits are not compiled.")).toBeTruthy();
  });

  it("names each file it would write", () => {
    draw(
      compiled({
        files: [{ path: "modinfo.lua", contents: "return {}\n" }],
      }),
    );
    expect(screen.getByText("modinfo.lua")).toBeTruthy();
  });

  it("says so rather than showing an empty drawer for a project with no edits", () => {
    draw(compiled());
    expect(
      screen.getByText(
        "This project changes nothing yet, so there is nothing to compile.",
      ),
    ).toBeTruthy();
  });

  it("reports a compiler that would not run", () => {
    draw({ compiled: null, loading: false, error: "command not found" });
    expect(
      screen.getByText(/The compiler could not run: command not found/),
    ).toBeTruthy();
  });
});
