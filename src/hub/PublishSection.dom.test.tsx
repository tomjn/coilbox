// @vitest-environment happy-dom

/** The hub section of the share drawer (#4821): the Title starts as the item's
 * name, and the sign-in check shows a spinner instead of a bare line. */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({
  current: {
    loading: false,
    signedIn: true,
    unknown: false,
    busy: false,
    problem: null as string | null,
    signIn: () => {},
    recheck: () => {},
  },
}));

vi.mock("@picoframe/frame", async () => {
  const { forwardRef } = await import("react");
  return {
    cn: (...c: unknown[]) => c.filter(Boolean).join(" "),
    Button: forwardRef<HTMLButtonElement, Record<string, unknown>>(
      ({ variant: _v, size: _s, ...props }, ref) => (
        <button ref={ref} type="button" {...props} />
      ),
    ),
    Input: forwardRef<HTMLInputElement, Record<string, unknown>>(
      (props, ref) => <input ref={ref} {...props} />,
    ),
  };
});
vi.mock("./account", () => ({ useHubAccount: () => account.current }));
vi.mock("./config", () => ({ useHubUrl: () => "https://hub.test" }));
vi.mock("@/profile/profile", () => ({ isHubEnabled: () => true }));
vi.mock("@/home/navItem", () => ({ openExternal: () => {} }));

import { newStoredBlueprint } from "@/blueprint/library";
import { encodePayloadCode } from "@/blueprint/transfer";
import { PublishSection } from "./PublishSection";

const made = encodePayloadCode(newStoredBlueprint("Plaza", "Zero-K v1").layout);
const code = made.ok ? made.code : "";

beforeEach(() => {
  account.current = { ...account.current, loading: false, signedIn: true };
});
afterEach(cleanup);

describe("PublishSection title", () => {
  it("starts as the name the caller passes", () => {
    render(<PublishSection code={code} title="Example: raised plaza" />);
    const title = screen.getByLabelText("Title") as HTMLInputElement;
    expect(title.value).toBe("Example: raised plaza");
  });

  it("stays editable", () => {
    render(<PublishSection code={code} title="Example: raised plaza" />);
    const title = screen.getByLabelText("Title") as HTMLInputElement;
    fireEvent.change(title, { target: { value: "My plaza" } });
    expect(title.value).toBe("My plaza");
  });

  it("is empty when the caller has no name to give", () => {
    render(<PublishSection code={code} />);
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("");
  });
});

describe("PublishSection sign-in check", () => {
  it("shows a spinner while it checks", () => {
    account.current = { ...account.current, loading: true };
    const { container } = render(<PublishSection code={code} />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(
      container.querySelector("svg.animate-spin, svg[class*='animate-spin']"),
    ).not.toBeNull();
    expect(screen.queryByLabelText("Title")).toBeNull();
  });
});
