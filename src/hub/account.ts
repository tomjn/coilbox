/**
 * Who is signed in to the hub, as a hook, so the three places that ask are
 * asking the same thing.
 *
 * It started as private state inside the settings section, on the reasoning that
 * signing in is a once-a-lifetime errand and browsing needs no account at all.
 * That is still true, but it left the sign-in button somewhere nobody looks: the
 * publish form's answer to being signed out was to name a Settings page and stop.
 * So the state moved out here and the button now appears where the question comes
 * up - on the hub screen and in the publish form - while sign-out stays in
 * Settings, where an action taken once belongs.
 *
 * The state is one store per hub address rather than one copy per component. It
 * used to be per component, and each one asked on mount, so opening the hub had
 * its header, its publish form and its settings section all asking at once. On
 * macOS that is three keychain prompts in a row. The Rust side now serialises
 * those reads too, and either fix alone would do, but a component asking a
 * question two others have already asked is worth not doing in the first place.
 *
 * The store is module state rather than a Provider on purpose. A Provider would
 * have to mount app-wide to be useful, and would then ask who is signed in at
 * launch, on behalf of everybody who never opens the hub. This asks the first
 * time somebody wants to know.
 *
 * Each hub is a separate account, so changing the address asks the new one.
 *
 * No token is on this side of the boundary. The Rust plugin keeps the refresh
 * token in the OS keychain and the access token in memory, and answers only with
 * who is signed in. See `./auth`.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { describeError } from "@/i18n/uiError";
import {
  type HubIdentity,
  hubAccount,
  hubProviders,
  hubSignIn,
  hubSignOut,
} from "./auth";

export interface HubAccount {
  /** The first answer has not come back yet. */
  loading: boolean;
  /** A sign-in or sign-out is in flight. */
  busy: boolean;
  signedIn: boolean;
  /** The check itself failed, so whether you are signed in is not known. A
   * keychain that never answered (issue #1456) is the usual reason, and it says
   * nothing about what is stored in it, so `signedIn` being false here means
   * "not known" rather than "signed out". */
  unknown: boolean;
  /** Who, when the hub said. Null while signed out, and also for a signed-in
   * session whose name could not be fetched this time. */
  account: HubIdentity | null;
  /** Something to show the reader, or null. A hub nobody can reach says nothing
   * about the sign-in, so this is separate from `signedIn`. */
  problem: string | null;
  signIn: (provider: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Ask again. The answer is kept for the session, so nothing else would. */
  recheck: () => Promise<void>;
}

/** What is known about one hub, without the actions. */
type Known = Omit<HubAccount, "signIn" | "signOut" | "recheck">;

/** Before anybody has asked. Shared, so an unvisited hub keeps one identity for
 * `useSyncExternalStore`, which compares snapshots by reference. */
const UNASKED: Known = {
  loading: true,
  busy: false,
  signedIn: false,
  unknown: false,
  account: null,
  problem: null,
};

const known = new Map<string, Known>();
/** Hubs with a question already in the air, so the second asker doesn't ask. */
const asking = new Set<string>();
const listeners = new Set<() => void>();

function snapshot(hubUrl: string): Known {
  return known.get(hubUrl) ?? UNASKED;
}

function update(hubUrl: string, change: Partial<Known>) {
  known.set(hubUrl, { ...snapshot(hubUrl), ...change });
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Put the question to the Rust side, once at a time per hub. */
async function ask(hubUrl: string) {
  if (asking.has(hubUrl)) return;
  asking.add(hubUrl);
  try {
    const state = await hubAccount({ hubUrl });
    update(hubUrl, { ...state, loading: false, unknown: false });
  } catch (e) {
    // Not "signed out". The command fails when coilbox could not find out, most
    // often a keychain that did not answer, and what is stored behind it is
    // exactly what nobody knows. See `unknown`.
    update(hubUrl, {
      loading: false,
      unknown: true,
      signedIn: false,
      account: null,
      problem: describeError(e),
    });
  } finally {
    asking.delete(hubUrl);
  }
}

/**
 * Ask the hub who we are, unless somebody already has.
 *
 * Exported for the test that holds the dedupe still, since the hook it serves
 * needs a renderer and this needs nothing.
 */
export async function askHubWhoWeAre(hubUrl: string) {
  if (known.has(hubUrl)) return;
  await ask(hubUrl);
}

/**
 * Ask again, however it went last time.
 *
 * The answer is kept for the session, so a check that failed is the last word
 * until something asks for another one. That was the dead end in issue #1456:
 * the keychain never answered, and nothing could ask it twice.
 */
export async function recheckHubAccount(hubUrl: string) {
  if (asking.has(hubUrl)) return;
  update(hubUrl, { loading: true, problem: null });
  await ask(hubUrl);
}

/**
 * Sign in through the browser, and record how it went.
 *
 * A sign-in can come back signed in and with something to say: the token was
 * not kept, most often a keychain that did not answer inside its deadline
 * (issue #1469). That is `problem` beside `signedIn`, not instead of it, because
 * this session can publish and only the next run is in doubt.
 *
 * Resolves to the failure's message, or null when this attempt signed in, so a
 * caller can tell its own attempt apart from what the store held before.
 */
export async function signInToHub(
  hubUrl: string,
  provider: string,
): Promise<string | null> {
  update(hubUrl, { busy: true, problem: null });
  try {
    const { account, problem } = await hubSignIn({ hubUrl, provider });
    update(hubUrl, {
      account,
      signedIn: true,
      unknown: false,
      loading: false,
      problem: problem ?? null,
    });
    return null;
  } catch (e) {
    const failure = describeError(e);
    update(hubUrl, { problem: failure });
    return failure;
  } finally {
    update(hubUrl, { busy: false });
  }
}

/**
 * Sign out, and record how it went.
 *
 * A sign-out that failed leaves `signedIn` alone rather than clearing it. The
 * keychain delete has a deadline, and a delete coilbox stopped waiting for may
 * still land or may not have happened at all (issue #1469), so the stored
 * sign-in's fate is exactly what nobody knows. Showing signed out on that would
 * be a guess dressed as a fact.
 */
export async function signOutOfHub(hubUrl: string) {
  update(hubUrl, { busy: true, problem: null });
  try {
    await hubSignOut({ hubUrl });
    update(hubUrl, {
      account: null,
      signedIn: false,
      unknown: false,
      loading: false,
    });
  } catch (e) {
    update(hubUrl, { problem: describeError(e) });
  } finally {
    update(hubUrl, { busy: false });
  }
}

/** What is known about a hub right now. For the hook, and for tests. */
export function hubAccountSnapshot(hubUrl: string): Known {
  return snapshot(hubUrl);
}

export function useHubAccount(hubUrl: string): HubAccount {
  const state = useSyncExternalStore(
    subscribe,
    useCallback(() => snapshot(hubUrl), [hubUrl]),
  );

  useEffect(() => {
    void askHubWhoWeAre(hubUrl);
  }, [hubUrl]);

  const recheck = useCallback(() => recheckHubAccount(hubUrl), [hubUrl]);

  const signIn = useCallback(
    async (provider: string) => {
      await signInToHub(hubUrl, provider);
    },
    [hubUrl],
  );
  const signOut = useCallback(() => signOutOfHub(hubUrl), [hubUrl]);

  return { ...state, signIn, signOut, recheck };
}

/**
 * What a hub offers when it cannot be asked. Every hub before
 * tomjn/coilbox-hub#522 signed in with Discord alone, and a hub that cannot be
 * reached fails the sign-in itself with words that say so.
 */
const DEFAULT_PROVIDERS: readonly string[] = ["discord"];

/** Each hub's providers, once asked. Separate from {@link known} because
 * asking reaches the hub, and the account check must not wait on that. */
const providersKnown = new Map<string, readonly string[]>();
const providersAsking = new Set<string>();

async function askProviders(hubUrl: string) {
  if (providersKnown.has(hubUrl) || providersAsking.has(hubUrl)) return;
  providersAsking.add(hubUrl);
  let providers = DEFAULT_PROVIDERS;
  try {
    providers = (await hubProviders({ hubUrl })).providers;
  } catch {
    // Not worth a message of its own. Pressing sign in reaches the hub again
    // and says what is wrong.
  } finally {
    providersAsking.delete(hubUrl);
  }
  providersKnown.set(hubUrl, providers);
  for (const listener of listeners) listener();
}

/**
 * Which providers to offer a sign-in with, or null until the hub has answered.
 * Asked once a session per hub.
 */
export function useHubProviders(hubUrl: string): readonly string[] | null {
  const providers = useSyncExternalStore(
    subscribe,
    useCallback(() => providersKnown.get(hubUrl) ?? null, [hubUrl]),
  );
  useEffect(() => {
    void askProviders(hubUrl);
  }, [hubUrl]);
  return providers;
}

/** Forget every answer. For tests, which must not inherit each other's hubs. */
export function forgetHubAccounts() {
  known.clear();
  asking.clear();
  providersKnown.clear();
  providersAsking.clear();
}
