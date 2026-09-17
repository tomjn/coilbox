// @vitest-environment happy-dom

/**
 * The shared way a Server admin tool sends a command and shows where it got
 * to (issue #2773). The queue and parsing are Rust's and tested there. These
 * cover what the page does with each outcome.
 */

import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminOutcome } from "../bindings";
import { AdminRequestStatus } from "./AdminRequestStatus";
import {
  type AdminRequestState,
  sendAdminCommand,
  useAdminRequest,
} from "./adminRequest";

const mpAdminCommand = vi.hoisted(() =>
  vi.fn<(args: unknown) => Promise<AdminOutcome>>(),
);
vi.mock("../bindings", () => ({ mpAdminCommand }));

afterEach(() => {
  cleanup();
  mpAdminCommand.mockReset();
});

/** A promise the test settles when it chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const EMPTY_BANS: AdminOutcome = {
  outcome: "answered",
  reply: { shape: "banList", entries: [] },
};

describe("sendAdminCommand", () => {
  it("sends on the connection it names", async () => {
    mpAdminCommand.mockResolvedValue(EMPTY_BANS);
    await expect(
      sendAdminCommand("mod@uber-a.example:8200", "LISTBANS", [], "banList"),
    ).resolves.toEqual(EMPTY_BANS);
    expect(mpAdminCommand).toHaveBeenCalledWith({
      serverKey: "mod@uber-a.example:8200",
      command: "LISTBANS",
      args: [],
      shape: "banList",
    });
  });
});

describe("useAdminRequest", () => {
  it("is sending until the answer, then answered", async () => {
    const pending = deferred<AdminOutcome>();
    mpAdminCommand.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useAdminRequest("key-a"));
    expect(result.current.state).toEqual({ status: "idle" });

    let sent!: Promise<AdminRequestState>;
    act(() => {
      sent = result.current.send("LISTBANS", [], "banList");
    });
    expect(result.current.state).toEqual({ status: "sending" });

    await act(async () => pending.resolve(EMPTY_BANS));
    const answered = {
      status: "answered",
      reply: { shape: "banList", entries: [] },
    };
    expect(result.current.state).toEqual(answered);
    await expect(sent).resolves.toEqual(answered);
  });

  it("carries the server's reason for a refusal", async () => {
    mpAdminCommand.mockResolvedValue({
      outcome: "refused",
      reason: "Insufficient rights.",
    });
    const { result } = renderHook(() => useAdminRequest("key-a"));
    await act(() => result.current.send("LISTBANS", [], "banList"));
    expect(result.current.state).toEqual({
      status: "refused",
      reason: "Insufficient rights.",
    });
  });

  it("reports silence as unanswered", async () => {
    mpAdminCommand.mockResolvedValue({ outcome: "unanswered" });
    const { result } = renderHook(() => useAdminRequest("key-a"));
    await act(() => result.current.send("GETIP", ["Bob"], "ipLookup"));
    expect(result.current.state).toEqual({ status: "unanswered" });
  });

  it("reports a command that never reached the server as failed", async () => {
    mpAdminCommand.mockRejectedValue(
      new Error("the connection ended before the server answered"),
    );
    const { result } = renderHook(() => useAdminRequest("key-a"));
    await act(() => result.current.send("LISTBANS", [], "banList"));
    expect(result.current.state).toEqual({
      status: "failed",
      error: "the connection ended before the server answered",
    });
  });

  it("does not send without a connection", async () => {
    const { result } = renderHook(() => useAdminRequest(null));
    await act(() => result.current.send("LISTBANS", [], "banList"));
    expect(result.current.state).toEqual({
      status: "failed",
      error: "Not connected.",
    });
    expect(mpAdminCommand).not.toHaveBeenCalled();
  });

  it("never shows one server's result after switching to another", async () => {
    const pending = deferred<AdminOutcome>();
    mpAdminCommand.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(({ key }) => useAdminRequest(key), {
      initialProps: { key: "key-a" },
    });
    act(() => {
      void result.current.send("LISTBANS", [], "banList");
    });
    rerender({ key: "key-b" });
    expect(result.current.state).toEqual({ status: "idle" });

    await act(async () => pending.resolve(EMPTY_BANS));
    expect(result.current.state).toEqual({ status: "idle" });
  });

  it("shows only the latest send when an older one settles after it", async () => {
    const first = deferred<AdminOutcome>();
    const second = deferred<AdminOutcome>();
    mpAdminCommand
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useAdminRequest("key-a"));
    act(() => {
      void result.current.send("GETIP", ["Alice"], "ipLookup");
      void result.current.send("GETIP", ["Bob"], "ipLookup");
    });

    await act(async () => second.resolve({ outcome: "unanswered" }));
    await act(async () => first.resolve(EMPTY_BANS));
    expect(result.current.state).toEqual({ status: "unanswered" });
  });
});

describe("AdminRequestStatus", () => {
  it("keeps an empty live region mounted while idle", () => {
    render(<AdminRequestStatus state={{ status: "idle" }} />);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("says it is waiting while sending", () => {
    render(<AdminRequestStatus state={{ status: "sending" }} />);
    expect(screen.getByRole("status").textContent).toContain(
      "Waiting for the server",
    );
  });

  it("words the wait the way the tool asks, for a command with no early end marker", () => {
    render(
      <AdminRequestStatus
        state={{ status: "sending" }}
        sending="This can take up to 20 seconds…"
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "This can take up to 20 seconds…",
    );
  });

  it("shows the answer the way the tool draws it", () => {
    render(
      <AdminRequestStatus
        state={{
          status: "answered",
          reply: { shape: "banList", entries: [] },
        }}
      >
        {(reply) =>
          reply.shape === "banList" && reply.entries.length === 0
            ? "No bans"
            : "Some bans"
        }
      </AdminRequestStatus>,
    );
    expect(screen.getByRole("status").textContent).toBe("No bans");
  });

  it("shows a refusal as an alert with the server's words", () => {
    render(
      <AdminRequestStatus
        state={{ status: "refused", reason: "Insufficient rights." }}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The server refused");
    expect(alert.textContent).toContain("Insufficient rights.");
  });

  it("shows a failed send as an alert", () => {
    render(
      <AdminRequestStatus
        state={{ status: "failed", error: "not connected: key-a" }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "not connected: key-a",
    );
  });

  it("words silence the way the tool asks, not as an error", () => {
    render(
      <AdminRequestStatus
        state={{ status: "unanswered" }}
        unanswered="No accounts seen on this IP"
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "No accounts seen on this IP",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
