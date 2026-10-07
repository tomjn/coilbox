// @vitest-environment happy-dom

/**
 * What the message list draws: a run of join and leave notices as one line,
 * and each message's time inside its bubble.
 */

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ChatMsg } from "../bindings";
import { ChatPane } from "./ChatPane";

vi.mock("@picoframe/frame", () => ({
  Button: ({
    children,
    ...props
  }: { children?: ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Input: (props: Record<string, unknown>) => <input {...props} />,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  useTheme: () => ({ resolved: "dark" }),
}));

const NOON = new Date(2026, 9, 7, 12, 0).getTime();

function msg(from: string, kind: ChatMsg["kind"], text = ""): ChatMsg {
  return { channel: "main", from, text, kind, at: NOON, id: null };
}

const draw = (messages: ChatMsg[]) =>
  render(<ChatPane title="#main" messages={messages} onSend={() => {}} />);

afterEach(cleanup);

it("folds a run of joins and leaves into one line", () => {
  draw([
    msg("walleye", "join"),
    msg("walleye", "leave"),
    msg("walleye", "join"),
    msg("amir", "leave"),
    msg("eden", "join"),
    msg("kawaii", "leave"),
    msg("amir", "join"),
  ]);
  const line = screen.getByText("walleye").closest("div");
  expect(line?.textContent?.trim()).toBe(
    "walleye and eden joined. amir rejoined. kawaii left.",
  );
  expect(screen.getAllByText("walleye")).toHaveLength(1);
});

it("counts the names past the first four, and keeps them in the tooltip", () => {
  const names = ["a", "b", "c", "d", "e", "f"];
  draw(names.map((n) => msg(n, "join")));
  const part = screen.getByTitle(names.join(", "));
  expect(part.textContent?.trim()).toBe("a, b, c, d and 2 others joined.");
});

it("draws a notice with nothing beside it as before, reason included", () => {
  draw([msg("alice", "said", "hello"), msg("bob", "leave", "timeout")]);
  expect(screen.getByText("bob").parentElement?.textContent).toBe(
    "bob left: timeout",
  );
});

it("puts the time inside the bubble, on every message", () => {
  draw([msg("alice", "said", "one"), msg("alice", "said", "two")]);
  const time = new Date(NOON).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const times = screen.getAllByText(time);
  expect(times).toHaveLength(2);
  expect(times[0].parentElement?.textContent).toBe(`one${time}`);
});
