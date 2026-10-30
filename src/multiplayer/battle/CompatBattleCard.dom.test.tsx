// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router", () => ({ useNavigate: () => navigate }));

const { CompatBattleCard } = await import("./CompatBattleCard");

afterEach(() => {
  cleanup();
  navigate.mockReset();
});

describe("CompatBattleCard", () => {
  it("renders nothing when there is no mutator to wait for", () => {
    const { container } = render(
      <CompatBattleCard state={{ status: "idle" }} onRetry={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows the Building state while the mutator is built", () => {
    render(
      <CompatBattleCard
        state={{ status: "building", baseName: "XTA 9.65", version: 4 }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/Building/)).toBeTruthy();
    expect(screen.getByText(/XTA 9\.65 \(compat 4\)/)).toBeTruthy();
  });

  it("shows how many models are done out of the total while it builds", () => {
    render(
      <CompatBattleCard
        state={{
          status: "building",
          baseName: "XTA 9.65",
          version: 4,
          progress: { done: 40, total: 300 },
        }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/40 of/)).toBeTruthy();
    expect(screen.getByText(/300 models/)).toBeTruthy();
    expect(
      screen.getByRole("progressbar", { name: /Models converted/ }),
    ).toBeTruthy();
  });

  it("shows no count before the build has counted its models", () => {
    render(
      <CompatBattleCard
        state={{
          status: "building",
          baseName: "XTA 9.65",
          version: 4,
          progress: { done: 0, total: 0 },
        }}
        onRetry={() => {}}
      />,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("says the host is on a newer coilbox and opens the updater", () => {
    render(
      <CompatBattleCard
        state={{
          status: "update",
          baseName: "XTA 9.65",
          version: 6,
          latest: 5,
        }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/The host is on a newer coilbox/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Update coilbox/ }));
    expect(navigate).toHaveBeenCalledWith("/settings/updates");
  });

  it("names a failed build and offers to try again", () => {
    const retry = vi.fn();
    render(
      <CompatBattleCard
        state={{
          status: "failed",
          baseName: "XTA 9.65",
          version: 4,
          error: "disk full",
        }}
        onRetry={retry}
      />,
    );
    expect(screen.getByText(/disk full/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(retry).toHaveBeenCalled();
  });
});
