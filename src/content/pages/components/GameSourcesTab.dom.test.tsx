// @vitest-environment happy-dom
/**
 * Issue #4580: the Sources tab lists the sources a download walks, with each
 * one's last result, and pins one with "Use this".
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RAPID_MASTERS } from "../../../downloads/rapidMasters";
import { MF_GAME, MF_HISTORY } from "../../fixtures/gamePage";
import { gameSourceRows } from "../../gameSourceRows";
import { GameSourcesTab, tookLabel } from "./GameSourcesTab";

afterEach(cleanup);

const rowsFor = (prefs = {}) =>
  gameSourceRows({
    game: MF_GAME,
    catalogRepo: null,
    masters: DEFAULT_RAPID_MASTERS,
    history: MF_HISTORY,
    prefs,
  });

const bodyRows = () => screen.getAllByRole("row").slice(1);

describe("Sources tab", () => {
  it("renders ok, failed and not tried rows in the order the download walks", () => {
    render(<GameSourcesTab rows={rowsFor()} onPin={() => {}} />);
    const [rapid, github, springfiles] = bodyRows();

    expect(within(rapid).getByText("Rapid")).toBeTruthy();
    expect(within(rapid).getByText("repos.springrts.com")).toBeTruthy();
    expect(within(rapid).getByText("mf:stable")).toBeTruthy();
    expect(within(rapid).getByText(/^ok · .*2026 · 2 min 10 s$/)).toBeTruthy();

    expect(within(github).getByText("GitHub")).toBeTruthy();
    expect(within(github).getByText("metalfactions/mf")).toBeTruthy();
    expect(within(github).getByText("not tried")).toBeTruthy();

    expect(within(springfiles).getByText("Springfiles")).toBeTruthy();
    expect(
      within(springfiles).getByText("mf-v1.4.sdz · 1 mirror"),
    ).toBeTruthy();
    expect(
      within(springfiles).getByText(
        /^failed .*2026 · one.example has no such file$/,
      ),
    ).toBeTruthy();
  });

  it("pins a source with Use this, and draws the pinned one first", () => {
    const onPin = vi.fn();
    render(<GameSourcesTab rows={rowsFor()} onPin={onPin} />);
    fireEvent.click(
      within(bodyRows()[2]).getByRole("button", { name: "Use this" }),
    );
    expect(onPin).toHaveBeenCalledWith({ source: "springfiles", mirror: null });
    cleanup();

    render(
      <GameSourcesTab
        rows={rowsFor({
          "game:metal factions": {
            pin: { source: "springfiles", mirror: null },
          },
        })}
        onPin={onPin}
      />,
    );
    const first = bodyRows()[0];
    expect(within(first).getByText("Springfiles")).toBeTruthy();
    expect(within(first).getByLabelText("Pinned")).toBeTruthy();
    fireEvent.click(within(first).getByRole("button", { name: "Unpin" }));
    expect(onPin).toHaveBeenLastCalledWith(null);
  });

  it("puts a download's duration in minutes and seconds", () => {
    expect(tookLabel(900)).toBe("1 s");
    expect(tookLabel(130_000)).toBe("2 min 10 s");
    expect(tookLabel(3_600_000)).toBe("1 h");
  });
});
