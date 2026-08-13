import { defineCommand } from "@picoframe/plugin-sdk";

/**
 * Typed bindings to the `coilbox-hub` plugin, which owns the Discord sign-in
 * (issue #1348).
 *
 * No token is here, and none ever will be. The Rust side keeps the refresh token
 * in the OS keychain and the access token in process memory, and hands the webview
 * only who is signed in. A token in this file would be readable by anything that
 * got a script into the webview.
 *
 * Every call takes the hub address rather than the plugin knowing one, because the
 * address is a user setting layered over a distribution profile's own. Call these
 * with {@link useHubUrl}'s answer.
 */

/** Who is signed in. What the hub shows on its own pages, and nothing more. */
export interface HubIdentity {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * The answer to "who am I". `signedIn` and `problem` are separate because the two
 * ways this goes wrong need different words: a refresh token the hub's account
 * service has thrown away means signed out, while a hub nobody can reach says
 * nothing at all about the sign-in and must not be reported as one.
 */
export interface HubAccountState {
  signedIn: boolean;
  account: HubIdentity | null;
  problem: string | null;
}

/**
 * Sign in with Discord through the system browser. Resolves once the user has
 * finished there, which can take a minute, and rejects if they never do.
 *
 * `problem` beside the account is a sign-in that worked but was not kept: the
 * keychain did not take the token inside its deadline, or would not take it at
 * all (issue #1469). This session is signed in either way, so it is a sentence
 * to show rather than a failure, and what it says is that next time may need the
 * browser again.
 */
export const hubSignIn = defineCommand<
  { hubUrl: string },
  { account: HubIdentity; problem: string | null }
>("coilbox-hub", "hub_sign_in");

/**
 * Forget this machine's sign-in. Coilbox holds a publishable key, which can revoke
 * nothing, so the token stops working here and stays alive in the hub's account
 * service.
 */
export const hubSignOut = defineCommand<
  { hubUrl: string },
  Record<string, never>
>("coilbox-hub", "hub_sign_out");

/** Who is signed in to this hub, if anybody. */
export const hubAccount = defineCommand<{ hubUrl: string }, HubAccountState>(
  "coilbox-hub",
  "hub_account",
);
