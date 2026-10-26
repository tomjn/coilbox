// @vitest-environment happy-dom
/**
 * Issue #4784: a mutator the hub lists that is not installed shows in the
 * Mutators tab with an Install button in place of Play and Delete.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryGame } from "../../library";

vi.mock("./DeleteArchiveButton", () => ({
  DeleteArchiveButton: () => <button type="button">Delete</button>,
}));

import { GameMutatorsTab } from "./GameMutatorsTab";

afterEach(cleanup);

const hubMutator: LibraryGame = {
  id: "mode",
  title: "Hub Mode",
  state: "available",
  installed: [],
  sources: [],
  parent: "bg",
};

function renderTab(overrides: { canInstall?: boolean; busy?: boolean } = {}) {
  const onInstall = vi.fn();
  const onPlay = vi.fn();
  render(
    <MemoryRouter>
      <GameMutatorsTab
        mutators={[hubMutator]}
        onPlay={onPlay}
        canInstall={overrides.canInstall ?? true}
        onInstall={onInstall}
        installing={new Set(overrides.busy ? ["mode"] : [])}
        failures={{}}
      />
    </MemoryRouter>,
  );
  return { onInstall, onPlay };
}

describe("a mutator that is not installed", () => {
  it("has an Install button and no Play or Delete", () => {
    const { onInstall } = renderTab();
    expect(screen.getByText("Hub Mode")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(onInstall).toHaveBeenCalledWith(hubMutator);
  });

  it("cannot be installed without a download folder", () => {
    renderTab({ canInstall: false });
    expect(
      (screen.getByRole("button", { name: "Install" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("cannot be installed twice while its sources resolve", () => {
    renderTab({ busy: true });
    expect(
      (screen.getByRole("button", { name: "Install" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
