// @vitest-environment happy-dom

/**
 * The firewall panel in the hosting drawer (issue #2799).
 *
 * Three things here would cost somebody a battle if they broke, and none of
 * them is the wording.
 *
 * That it draws nothing off Windows. The whole panel is about a Windows
 * question, and a Mac or Linux host reading about administrator prompts they
 * cannot answer would be worse than no panel at all. The gate is the backend's
 * `supported`, so a version that drew on the strength of the call having
 * returned would look right on Windows and wrong everywhere else.
 *
 * That it reports the rules rather than its own success. Adding the rules ends
 * in a Windows administrator prompt the host can refuse, and a panel that said
 * "allowed" because the command came back would send somebody into a game
 * believing a question had been answered.
 *
 * And that it asks again when the engine changes. Windows remembers an answer
 * per program file and each engine version is its own file, so a host who
 * switches engine has a program nothing has allowed and a panel that would
 * still be showing the last engine's answer.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Firewall } from "../bindings";
import { WindowsFirewall } from "./WindowsFirewall";

const firewall = vi.fn();
const firewallAllow = vi.fn();

vi.mock("../bindings", () => ({
  mpFirewall: (args: { engine?: string | null }) => firewall(args),
  mpFirewallAllow: (args: { engine?: string | null }) => firewallAllow(args),
}));

/** What Windows says, with everything named and nothing allowed. */
function blocked(): Firewall {
  return {
    supported: true,
    programs: [
      { name: "Coilbox", path: "C:\\c\\coilbox.exe", allowed: false },
      { name: "Coilbox relay", path: "C:\\c\\relay.exe", allowed: false },
      {
        name: "Coilbox engine (105.1.1)",
        path: "C:\\e\\105.1.1\\spring.exe",
        allowed: false,
      },
    ],
    problem: null,
  };
}

/** The same, with every rule in place. */
function allowed(): Firewall {
  const answer = blocked();
  return {
    ...answer,
    programs: answer.programs.map((p) => ({ ...p, allowed: true })),
  };
}

/** Draw the panel and let the first answer land. */
async function draw(engine: string | null = "C:\\e\\105.1.1\\spring.exe") {
  await act(async () => {
    render(<WindowsFirewall engine={engine} />);
  });
}

/** The button that raises the administrator prompt, or null when there is none. */
const allowButton = () =>
  screen.queryByRole("button", { name: /Allow them through/ });

beforeEach(() => {
  firewall.mockReset();
  firewallAllow.mockReset();
  firewall.mockResolvedValue(blocked());
});

afterEach(cleanup);

/**
 * The gate. Everything below it is Windows-only advice, and the backend is what
 * says whether this is Windows.
 */
it("draws nothing when the machine has no Windows Firewall", async () => {
  firewall.mockResolvedValue({
    supported: false,
    programs: [],
    problem: null,
  });
  await draw();

  expect(document.body.textContent).toBe("");
});

/** A backend that could not answer at all is not a firewall problem. */
it("draws nothing when the call fails", async () => {
  firewall.mockRejectedValue(new Error("no such command"));
  await draw();

  expect(document.body.textContent).toBe("");
});

it("names every program that is not allowed in, and offers to fix it", async () => {
  await draw();

  expect(screen.getByText("Coilbox")).toBeTruthy();
  expect(screen.getByText("Coilbox relay")).toBeTruthy();
  expect(screen.getByText("Coilbox engine (105.1.1)")).toBeTruthy();
  expect(allowButton()).not.toBeNull();
});

/**
 * Nothing to do, so nothing to press. A button that stayed would invite a host
 * to raise an administrator prompt that would change nothing.
 */
it("says so in one line when every rule is already there", async () => {
  firewall.mockResolvedValue(allowed());
  await draw();

  expect(
    screen.getByText(/already allows every program hosting needs/),
  ).toBeTruthy();
  expect(allowButton()).toBeNull();
});

it("asks about the engine the form is about to launch", async () => {
  await draw("C:\\e\\105.1.1\\spring.exe");

  expect(firewall).toHaveBeenCalledWith({
    engine: "C:\\e\\105.1.1\\spring.exe",
  });
});

/**
 * The engine changing is a new program Windows has never been asked about, so
 * the panel that was right a moment ago is not any more.
 */
it("asks again when the host switches engine", async () => {
  const one = "C:\\e\\one\\spring.exe";
  const two = "C:\\e\\two\\spring.exe";
  const { rerender } = render(<WindowsFirewall engine={one} />);
  await act(async () => {});
  expect(firewall).toHaveBeenCalledTimes(1);

  await act(async () => {
    rerender(<WindowsFirewall engine={two} />);
  });

  expect(firewall).toHaveBeenCalledTimes(2);
  expect(firewall).toHaveBeenLastCalledWith({ engine: two });
});

it("redraws from what the rules say once they have been added", async () => {
  firewallAllow.mockResolvedValue(allowed());
  await draw();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Allow them through/ }));
  });

  expect(firewallAllow).toHaveBeenCalledWith({
    engine: "C:\\e\\105.1.1\\spring.exe",
  });
  expect(
    screen.getByText(/already allows every program hosting needs/),
  ).toBeTruthy();
});

/**
 * The host said no to the administrator prompt. That is a choice, and it has to
 * reach the screen as one: a panel that swallowed it would leave somebody
 * believing a question had been answered when nothing had changed.
 */
it("says what happened when the administrator prompt is refused", async () => {
  firewallAllow.mockResolvedValue({
    ...blocked(),
    problem:
      "The Windows administrator prompt was refused, so nothing was changed.",
  });
  await draw();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Allow them through/ }));
  });

  expect(screen.getByText(/prompt was refused/)).toBeTruthy();
  expect(allowButton()).not.toBeNull();
});

/** A rejected call is coilbox not knowing, and it must not read as done. */
it("keeps the button when the call to add the rules fails outright", async () => {
  firewallAllow.mockRejectedValue(new Error("PowerShell is not on PATH"));
  await draw();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Allow them through/ }));
  });

  expect(screen.getByText(/PowerShell is not on PATH/)).toBeTruthy();
  expect(allowButton()).not.toBeNull();
});
