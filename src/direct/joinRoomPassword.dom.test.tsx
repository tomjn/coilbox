// @vitest-environment happy-dom

/**
 * The join form refuses a room password the join line cannot carry (issue
 * #3518). The line is space separated with no way to escape a space, so a
 * password with one would reach the server as two words and the join would fail
 * with nothing said.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JoinRoomForm } from "./JoinRoomForm";

vi.mock("@picoframe/frame", async () => {
  const actual = await vi.importActual<object>("@picoframe/frame");
  return { ...actual, useDrawer: () => ({ close: () => {} }) };
});

afterEach(cleanup);

function submitWith(password: string) {
  const onJoin = vi.fn(async () => {});
  render(
    <JoinRoomForm
      target={{
        address: "192.168.1.5",
        port: 8200,
        passworded: true,
        from: "network",
        title: "Tom's room",
      }}
      blocked={null}
      onJoin={onJoin}
    />,
  );
  fireEvent.change(screen.getByLabelText("Room password"), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Join/ }));
  return onJoin;
}

describe("joining a room with a password the line cannot carry", () => {
  it("refuses a password with a space and says why", () => {
    const onJoin = submitWith("let me in");

    expect(onJoin).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "A battle password cannot contain a space",
    );
  });

  it("refuses a password with a character outside the basic keyboard", () => {
    const onJoin = submitWith("pässword");

    expect(onJoin).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("sends an ordinary password, trimmed at the edges", async () => {
    const onJoin = submitWith("  s3cret!  ");

    await vi.waitFor(() => expect(onJoin).toHaveBeenCalledTimes(1));
    expect(onJoin).toHaveBeenCalledWith(
      expect.objectContaining({ password: "s3cret!" }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("joins an open room with no password", async () => {
    const onJoin = submitWith("");

    await vi.waitFor(() => expect(onJoin).toHaveBeenCalledTimes(1));
    expect(onJoin).toHaveBeenCalledWith(
      expect.objectContaining({ password: "" }),
    );
  });
});
