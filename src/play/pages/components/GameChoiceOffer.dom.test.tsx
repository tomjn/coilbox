// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameOffer } from "../../installedGames";
import { GameChoiceOffer } from "./GameChoiceOffer";

afterEach(cleanup);

const game = (name: string) => ({ name, info: {} });

function show(offer: GameOffer, extra: { note?: string } = {}) {
  const onChoose = vi.fn();
  const onDecline = vi.fn();
  render(
    <GameChoiceOffer
      offer={offer}
      noun="warpath"
      busy={false}
      onChoose={onChoose}
      onDecline={onDecline}
      {...extra}
    />,
  );
  return { onChoose, onDecline };
}

describe("GameChoiceOffer", () => {
  it("names every candidate in full and answers with the one picked", () => {
    const { onChoose } = show({
      kind: "choose",
      candidates: [game("Zero-K Benchmark v3"), game("Zero-K v1.14.10.1")],
    });
    fireEvent.click(screen.getByRole("button", { name: "Zero-K v1.14.10.1" }));
    expect(
      screen.getByRole("button", { name: "Zero-K Benchmark v3" }),
    ).toBeTruthy();
    expect(onChoose).toHaveBeenCalledWith("Zero-K v1.14.10.1");
  });

  it("offers to continue on the other version by its full name", () => {
    const { onChoose } = show({
      kind: "continue",
      pinnedName: "Zero-K v1.14.8.0",
      newer: game("Zero-K v1.14.10.1"),
    });
    expect(screen.getByText("Zero-K v1.14.8.0")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue on Zero-K v1.14.10.1" }),
    );
    expect(onChoose).toHaveBeenCalledWith("Zero-K v1.14.10.1");
  });

  it("lets the player stay on the current version, and says what that declines", () => {
    const { onChoose, onDecline } = show(
      {
        kind: "upgrade",
        current: game("Zero-K v1.14.8.0"),
        newer: game("Zero-K v1.14.10.1"),
      },
      { note: "Zero-K v1.14.10.1 does not have these units from your run: x." },
    );
    expect(screen.getByText(/does not have these units/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Stay on Zero-K v1.14.8.0" }),
    );
    expect(onDecline).toHaveBeenCalledWith("Zero-K v1.14.10.1");
    expect(onChoose).not.toHaveBeenCalled();
  });
});
