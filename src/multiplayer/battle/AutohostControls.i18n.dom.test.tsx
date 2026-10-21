// @vitest-environment happy-dom

/**
 * Issue #4602: the autohost buttons are labelled from the Lingui catalog, but
 * the `!` command each one sends is a protocol token and never changes. The
 * catalog here is a fixture that renames every label.
 */

import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutohostControls } from "./AutohostControls";

vi.mock("@picoframe/frame", () => ({
  Button: ({
    children,
    ...props
  }: { children?: ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

function fixtureCatalog() {
  return {
    [msg`Balance`.id]: "Fixture balance",
    [msg`Fix colours`.id]: "Fixture fix colours",
    [msg`Ring unready`.id]: "Fixture ring",
    [msg`Lock`.id]: "Fixture lock",
    [msg`Unlock`.id]: "Fixture unlock",
    [msg`Suggest balance`.id]: "Fixture suggest balance",
    [msg`Suggest lock`.id]: "Fixture suggest lock",
    [msg`Suggest unlock`.id]: "Fixture suggest unlock",
  };
}

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

function renderControls(over: { locked: boolean; directRoom: boolean }) {
  const onCommand = vi.fn();
  i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
  render(
    <I18nProvider i18n={i18n}>
      <AutohostControls
        locked={over.locked}
        directRoom={over.directRoom}
        selfHost={false}
        onCommand={onCommand}
        onRing={vi.fn()}
      />
    </I18nProvider>,
  );
  return onCommand;
}

describe("the autohost command table under a fixture catalog", () => {
  it.each([
    { locked: false, directRoom: false },
    { locked: true, directRoom: false },
    { locked: false, directRoom: true },
    { locked: true, directRoom: true },
  ])("sends the exact `!` commands (locked: $locked, direct room: $directRoom)", (state) => {
    const onCommand = renderControls(state);
    for (const button of screen.getAllByRole("button")) fireEvent.click(button);
    const sent = onCommand.mock.calls.map((call) => call[0]);
    const lock = state.locked ? "!unlock" : "!lock";
    expect(sent).toEqual(
      state.directRoom
        ? ["!balance", "!ring", lock]
        : ["!balance", "!fixcolors", "!ring", lock],
    );
  });

  it("labels the buttons from the catalog", () => {
    renderControls({ locked: false, directRoom: false });
    expect(screen.getByText("Fixture balance")).toBeTruthy();
    expect(screen.getByText("Fixture fix colours")).toBeTruthy();
    expect(screen.getByText("Fixture ring")).toBeTruthy();
    expect(screen.getByText("Fixture lock")).toBeTruthy();
    expect(screen.queryByText("Balance")).toBeNull();
  });
});
