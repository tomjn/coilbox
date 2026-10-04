// @vitest-environment happy-dom

/**
 * The password field refuses a password the join line cannot carry (issue
 * #3410). The line is space separated with no way to escape a space, so a
 * password with one would reach the server as two words.
 *
 * The popover is stood in for so its contents are always drawn.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JoinBattlePopover } from "./JoinBattlePopover";

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

afterEach(cleanup);

function draw(protocol?: "tasserver" | "zerok" | "tachyon") {
  const onSubmit = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <JoinBattlePopover
      title="Open game"
      disabled={false}
      onSubmit={onSubmit}
      open={true}
      onOpenChange={onOpenChange}
      protocol={protocol}
    />,
  );
  return { onSubmit, onOpenChange };
}

function typeAndSubmit(password: string) {
  const field = screen.getByPlaceholderText("Battle password");
  fireEvent.change(field, { target: { value: password } });
  const form = field.closest("form");
  if (!form) throw new Error("no form");
  fireEvent.submit(form);
}

describe("the battle password field", () => {
  it("refuses a password with a space and says why", () => {
    const { onSubmit, onOpenChange } = draw();
    typeAndSubmit("two words");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("alert").textContent).toContain("space");
  });

  it("clears the message once the password is changed", () => {
    draw();
    typeAndSubmit("two words");
    fireEvent.change(screen.getByPlaceholderText("Battle password"), {
      target: { value: "oneword" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hands a password with no space up and closes", () => {
    const { onSubmit, onOpenChange } = draw();
    typeAndSubmit("s3cret!");
    expect(onSubmit).toHaveBeenCalledWith("s3cret!");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("the battle password field on a Zero-K server (issue #3524)", () => {
  it("hands a password with a space up, which the server takes as JSON", () => {
    const { onSubmit, onOpenChange } = draw("zerok");
    typeAndSubmit("my pass");
    expect(onSubmit).toHaveBeenCalledWith("my pass");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hands up a non-ASCII password", () => {
    const { onSubmit } = draw("zerok");
    typeAndSubmit("pässword");
    expect(onSubmit).toHaveBeenCalledWith("pässword");
  });

  it("trims the outer spaces, as the host form does", () => {
    const { onSubmit } = draw("zerok");
    typeAndSubmit("  my pass  ");
    expect(onSubmit).toHaveBeenCalledWith("my pass");
  });

  it("still refuses a space on a TASServer style server", () => {
    const { onSubmit } = draw("tasserver");
    typeAndSubmit("my pass");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("space");
  });
});
