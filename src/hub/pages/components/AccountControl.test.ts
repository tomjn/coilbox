/**
 * What Settings and the hub header say when coilbox could not find out whether
 * you are signed in (issue #1470).
 *
 * A check that failed is its own state: `unknown` rather than signed out, since
 * a keychain that did not answer says nothing about what is behind it. The
 * publish form learnt that in #1456 and gained a Try again with it. These two
 * kept showing the failure with no way to ask again, and the answer is held for
 * the session, so the only ways past it were signing in or restarting coilbox.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { HubAccount } from "../../account";

const SIGNED_OUT: HubAccount = {
  loading: false,
  busy: false,
  signedIn: false,
  unknown: false,
  account: null,
  problem: null,
  signIn: async () => {},
  signOut: async () => {},
  recheck: async () => {},
};

let state: HubAccount = SIGNED_OUT;

vi.mock("../../account", () => ({ useHubAccount: () => state }));

const { AccountControl } = await import("./AccountControl");
const { HeaderAccount } = await import("./HeaderAccount");

/** A surface, rendered against one answer from the hook. */
function markup(
  surface: typeof AccountControl | typeof HeaderAccount,
  answer: Partial<HubAccount>,
): string {
  state = { ...SIGNED_OUT, ...answer };
  try {
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(surface, { hubUrl: "https://hub.example" }),
      ),
    );
  } finally {
    state = SIGNED_OUT;
  }
}

/** The check itself failed. Not signed out: nobody knows either way. */
const UNKNOWN: Partial<HubAccount> = {
  unknown: true,
  problem: "Coilbox could not read the system keychain in time.",
};

describe("Settings > Coilbox hub, when the check could not find out", () => {
  it("offers to ask again", () => {
    expect(markup(AccountControl, UNKNOWN)).toContain("Try again");
  });

  /** It led with "You need an account to share things on the hub", which is
   *  true of the hub and not the thing that just happened. */
  it("leads with what happened rather than with needing an account", () => {
    const html = markup(AccountControl, UNKNOWN);
    expect(html).toContain("could not tell whether you are signed in");
    expect(html).not.toContain("You need an account");
  });

  it("still says what went wrong", () => {
    expect(markup(AccountControl, UNKNOWN)).toContain("keychain");
  });

  it("offers nothing to retry to somebody plainly signed out", () => {
    const html = markup(AccountControl, {});
    expect(html).not.toContain("Try again");
    expect(html).toContain("You need an account");
  });
});

describe("the hub header, when the check could not find out", () => {
  it("offers to ask again", () => {
    expect(markup(HeaderAccount, UNKNOWN)).toContain("Try again");
  });

  it("offers nothing to retry to somebody plainly signed out", () => {
    expect(markup(HeaderAccount, {})).not.toContain("Try again");
  });

  it("offers nothing to retry to somebody signed in", () => {
    const html = markup(HeaderAccount, {
      signedIn: true,
      account: { id: "1", name: "Someone", avatarUrl: null },
    });
    expect(html).not.toContain("Try again");
    expect(html).toContain("Someone");
  });
});
