// @vitest-environment happy-dom

/** The share drawer offers a Copy link button only for a code within
 * `MAX_LINK_CODE_LENGTH`, and always offers the code itself (issue #5150). That
 * limit comes from documented Windows and Linux command line limits and has not
 * been measured on either system. */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@picoframe/frame", async () => {
  const { forwardRef } = await import("react");
  return {
    Button: forwardRef<HTMLButtonElement, Record<string, unknown>>(
      ({ variant: _v, size: _s, ...props }, ref) => (
        <button ref={ref} type="button" {...props} />
      ),
    ),
  };
});
vi.mock("@/hub/PublishSection", () => ({ PublishSection: () => null }));

import { ChallengeCodeView } from "@/challenge/ChallengeCodeView";
import { MAX_LINK_CODE_LENGTH } from "@/deeplink/parse";

afterEach(cleanup);

describe("Copy link on the share drawer", () => {
  it("is offered for a code at the link limit", () => {
    render(
      <ChallengeCodeView
        code={"a".repeat(MAX_LINK_CODE_LENGTH)}
        helpText="Help"
      />,
    );
    expect(screen.getByRole("button", { name: /copy link/i })).toBeTruthy();
  });

  it("is not offered one character over, and the code can still be copied", () => {
    const code = "a".repeat(MAX_LINK_CODE_LENGTH + 1);
    render(<ChallengeCodeView code={code} helpText="Help" />);
    expect(screen.queryByRole("button", { name: /copy link/i })).toBeNull();
    expect(screen.getByRole("button", { name: /copy code/i })).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      code,
    );
  });
});
