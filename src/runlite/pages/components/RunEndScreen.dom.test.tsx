// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { generateRun } from "../../generate";
import type { RogueliteRun } from "../../model";
import { RunEndScreen } from "./RunEndScreen";

afterEach(cleanup);

const run: RogueliteRun = generateRun({
  seed: 777,
  length: "standard",
  difficulty: 3,
  ascension: 1,
  game: { shortname: "ba" },
  factionId: "player",
  side: "ARM",
  skin: "galaxy",
  maps: [
    { name: "Small", size: 64 },
    { name: "Medium", size: 256 },
  ],
  now: "2026-07-18T00:00:00.000Z",
});

function renderEnd(status: "won" | "lost", hull: number, salvage: number) {
  render(
    <MemoryRouter>
      <RunEndScreen
        run={{ ...run, progress: { ...run.progress, status, hull, salvage } }}
        onClear={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("the warpath end screen", () => {
  it("shows hull remaining beside salvage banked", () => {
    renderEnd("won", 63, 240);
    expect(screen.getByText("Hull remaining").nextSibling?.textContent).toBe(
      "63",
    );
    expect(screen.getByText("Salvage banked").nextSibling?.textContent).toBe(
      "240",
    );
  });

  it("shows hull remaining after a loss", () => {
    renderEnd("lost", 0, 80);
    expect(screen.getByText("Hull remaining").nextSibling?.textContent).toBe(
      "0",
    );
  });
});
