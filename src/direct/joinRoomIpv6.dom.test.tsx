// @vitest-environment happy-dom

/**
 * The join form for a room at an IPv6 address (issue #3420). The form shows and
 * passes on the address in brackets, which is the form `connectDirect` and the
 * room's key use. Taking the brackets off for the dial is `ipv6Dial.dom.test.tsx`.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JoinRoomForm } from "./JoinRoomForm";

vi.mock("@picoframe/frame", async () => {
  const actual = await vi.importActual<object>("@picoframe/frame");
  return { ...actual, useDrawer: () => ({ close: () => {} }) };
});

afterEach(cleanup);

describe("joining a room from a link to an IPv6 address", () => {
  it("says where the link goes in brackets, with its port", () => {
    render(
      <JoinRoomForm
        target={{
          address: "[2001:db8::1]",
          port: 8200,
          passworded: false,
          from: "link",
        }}
        blocked={null}
        onJoin={async () => {}}
      />,
    );
    expect(
      screen.getByText(/to a room at \[2001:db8::1\]:8200\./),
    ).toBeTruthy();
  });

  it("hands the join the bracketed address and the port", () => {
    const onJoin = vi.fn(async () => {});
    render(
      <JoinRoomForm
        target={{
          address: "[2001:db8::1]",
          port: 8300,
          passworded: false,
          from: "link",
        }}
        blocked={null}
        onJoin={onJoin}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Join/ }));
    expect(onJoin).toHaveBeenCalledWith(
      expect.objectContaining({ address: "[2001:db8::1]", port: 8300 }),
    );
  });

  it("splits a pasted bracketed address and port into both fields", () => {
    const onJoin = vi.fn(async () => {});
    render(<JoinRoomForm blocked={null} onJoin={onJoin} />);
    fireEvent.change(screen.getByPlaceholderText("192.168.1.5"), {
      target: { value: "[::1]:8400" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Join/ }));
    expect(onJoin).toHaveBeenCalledWith(
      expect.objectContaining({ address: "[::1]", port: 8400 }),
    );
  });
});
