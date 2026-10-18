// @vitest-environment happy-dom
/**
 * Issue #4580: the Versions tab lists every named rapid tag and GitHub release
 * archive, marks the installed one and folds the commit snapshots.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BA_GAME, BA_RAPID, SF_GAME } from "../../fixtures/gamePage";
import { gameVersionRows } from "../../gameVersionRows";

vi.mock("./DeleteArchiveButton", () => ({
  DeleteArchiveButton: ({ name }: { name: string }) => (
    <button type="button">Remove {name}</button>
  ),
}));

import { GameVersionsTab } from "./GameVersionsTab";

afterEach(cleanup);

function renderTab(table: ReturnType<typeof gameVersionRows>) {
  const onInstall = vi.fn();
  render(
    <GameVersionsTab
      table={table}
      indexAge="Rapid index refreshed 3 min ago from repos.springrts.com"
      loading={false}
      errors={[]}
      canInstall
      statusOf={() => null}
      onInstall={onInstall}
      onRemoved={() => {}}
    />,
  );
  return { onInstall };
}

const bodyRows = () => screen.getAllByRole("row").slice(1);

describe("Versions tab", () => {
  it("renders rapid tags with the installed one marked and the snapshots folded", () => {
    const { onInstall } = renderTab(
      gameVersionRows(BA_GAME, BA_RAPID, "/data"),
    );
    const rows = bodyRows();
    // Three named tags, then the fold row.
    expect(rows).toHaveLength(4);

    const stable = rows[0];
    expect(within(stable).getByText("ba:stable")).toBeTruthy();
    expect(within(stable).getByLabelText("Installed")).toBeTruthy();
    expect(within(stable).getByText("installed · branch")).toBeTruthy();
    expect(within(stable).getByText("7c02…118a")).toBeTruthy();
    expect(within(stable).getByText("rapid://ba-chobby:stable")).toBeTruthy();
    expect(
      within(stable).getByRole("button", { name: "Remove ba-v15.9.8.sdz" }),
    ).toBeTruthy();

    expect(within(rows[1]).getByText("branch")).toBeTruthy();
    expect(within(rows[2]).getByText("release")).toBeTruthy();
    expect(within(rows[2]).getByText("V15.9.9")).toBeTruthy();
    expect(within(rows[1]).queryByLabelText("Installed")).toBeNull();

    fireEvent.click(within(rows[2]).getByRole("button", { name: "Install" }));
    expect(onInstall.mock.calls[0][0].request).toEqual({
      kind: "rapid",
      label: "Balanced Annihilation V15.9.9",
      args: {
        tag: "ba:15.9.9",
        masterUrl: "https://repos.springrts.com",
        writePath: "/data",
      },
    });

    expect(screen.queryByText("ba:git:111aaaa")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show 3 commit snapshots" }),
    );
    expect(screen.getByText("ba:git:111aaaa")).toBeTruthy();
    expect(bodyRows()).toHaveLength(7);

    expect(
      screen.getByText(
        "Rapid index refreshed 3 min ago from repos.springrts.com",
      ),
    ).toBeTruthy();
  });

  it("renders GitHub release archives with date and size, and the installed one marked", () => {
    renderTab(gameVersionRows(SF_GAME, [], "/data"));
    const rows = bodyRows();
    expect(rows).toHaveLength(2);
    const [newer, installed] = rows;
    expect(within(newer).getByText("0.1.87")).toBeTruthy();
    expect(within(newer).getByText("splinterfaction/sf")).toBeTruthy();
    expect(within(newer).getByText(/^release · .*2026 · 200 B$/)).toBeTruthy();
    expect(within(newer).getByRole("button", { name: "Install" })).toBeTruthy();
    expect(within(installed).getByLabelText("Installed")).toBeTruthy();
    expect(
      within(installed).getByText("SplinterFaction_0.1.86.sdz"),
    ).toBeTruthy();
    expect(screen.queryByText(/commit snapshots/)).toBeNull();
  });
});
