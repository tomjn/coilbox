import { beforeEach, describe, expect, it, vi } from "vitest";

const hubAccount = vi.fn();
vi.mock("./auth", () => ({
  hubAccount: (args: { hubUrl: string }) => hubAccount(args),
  hubSignIn: vi.fn(),
  hubSignOut: vi.fn(),
}));

const {
  askHubWhoWeAre,
  forgetHubAccounts,
  hubAccountSnapshot,
  recheckHubAccount,
} = await import("./account");

const signedIn = {
  signedIn: true,
  account: { id: "1", name: "Someone", avatarUrl: null },
  problem: null,
};

describe("who is signed in to the hub", () => {
  beforeEach(() => {
    forgetHubAccounts();
    hubAccount.mockReset();
  });

  /** The bug: the hub header, the publish form and the settings section all
   * asked on mount, and macOS prompted for the keychain once per asker. */
  it("asks once however many components want to know", async () => {
    hubAccount.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(signedIn), 10)),
    );
    await Promise.all([
      askHubWhoWeAre("https://hub.example"),
      askHubWhoWeAre("https://hub.example"),
      askHubWhoWeAre("https://hub.example"),
    ]);
    expect(hubAccount).toHaveBeenCalledTimes(1);
  });

  it("does not ask again once it has an answer", async () => {
    hubAccount.mockResolvedValue(signedIn);
    await askHubWhoWeAre("https://hub.example");
    await askHubWhoWeAre("https://hub.example");
    expect(hubAccount).toHaveBeenCalledTimes(1);
  });

  /** Each hub is its own account, so one answer is not the other's. */
  it("asks each hub separately", async () => {
    hubAccount.mockResolvedValue(signedIn);
    await askHubWhoWeAre("https://hub.example");
    await askHubWhoWeAre("https://other.example");
    expect(hubAccount).toHaveBeenCalledTimes(2);
  });

  /** A hub nobody can reach has still been asked, so asking again on every
   * render would be a request loop. */
  it("keeps a failure as the answer rather than retrying", async () => {
    hubAccount.mockRejectedValue(new Error("no route to host"));
    await askHubWhoWeAre("https://hub.example");
    await askHubWhoWeAre("https://hub.example");
    expect(hubAccount).toHaveBeenCalledTimes(1);
  });

  /** Issue #1456. A keychain that did not answer says nothing about whether
   * there is a sign-in behind it, so reporting it as signed out would offer to
   * sign in somebody who already is. */
  it("does not read a failed check as being signed out", async () => {
    hubAccount.mockRejectedValue(
      new Error("Coilbox could not read the system keychain in time."),
    );
    await askHubWhoWeAre("https://hub.example");
    const state = hubAccountSnapshot("https://hub.example");
    expect(state.unknown).toBe(true);
    expect(state.signedIn).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.problem).toContain("keychain");
  });

  /** The way out of a failed check, since the answer is cached for the session
   * and nothing else would ask again. */
  it("asks again when told to", async () => {
    hubAccount.mockRejectedValueOnce(new Error("no route to host"));
    hubAccount.mockResolvedValueOnce(signedIn);
    await askHubWhoWeAre("https://hub.example");
    await recheckHubAccount("https://hub.example");
    expect(hubAccount).toHaveBeenCalledTimes(2);
    const state = hubAccountSnapshot("https://hub.example");
    expect(state.signedIn).toBe(true);
    expect(state.unknown).toBe(false);
    expect(state.problem).toBe(null);
  });
});
