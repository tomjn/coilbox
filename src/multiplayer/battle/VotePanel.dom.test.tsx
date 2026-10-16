// @vitest-environment happy-dom

/**
 * The vote panel sits on one row (issue #4188), so a long question is cut off
 * with an ellipsis and carries its full text in a `title` for hover.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Vote } from "../bindings";
import { VotePanel } from "./VotePanel";

const vote: Vote = {
  subject: "kick a player with a very long name from this battle room",
  caller: "Alice",
  yes: 1,
  no: 0,
  yesNeeded: 3,
  noNeeded: 0,
  endsAt: 0,
  allowAbstain: false,
} as Vote;

afterEach(cleanup);

describe("VotePanel", () => {
  it("carries the full question and caller in a title", () => {
    render(<VotePanel vote={vote} onVote={vi.fn()} />);
    expect(screen.getByTitle(`${vote.subject} · by Alice`)).toBeTruthy();
  });

  it("still offers Yes and No", () => {
    const onVote = vi.fn();
    render(<VotePanel vote={vote} onVote={onVote} />);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onVote).toHaveBeenCalledWith("yes");
  });
});
