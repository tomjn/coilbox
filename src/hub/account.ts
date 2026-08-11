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
import { type HubIdentity, hubAccount, hubSignIn, hubSignOut } from "./auth";

export interface HubAccount {
  /** The first answer has not come back yet. */
  loading: boolean;
  /** A sign-in or sign-out is in flight. */
  busy: boolean;
  signedIn: boolean;
  /** Who, when the hub said. Null while signed out, and also for a signed-in
   * session whose name could not be fetched this time. */
  account: HubIdentity | null;
  /** Something to show the reader, or null. A hub nobody can reach says nothing
   * about the sign-in, so this is separate from `signedIn`. */
  problem: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

/** What is known about one hub, without the two actions. */
type Known = Omit<HubAccount, "signIn" | "signOut">;

/** Before anybody has asked. Shared, so an unvisited hub keeps one identity for
 * `useSyncExternalStore`, which compares snapshots by reference. */
const UNASKED: Known = {
  loading: true,
  busy: false,
  signedIn: false,
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

/**
 * Ask the hub who we are, unless somebody already has.
 *
 * Exported for the test that holds the dedupe still, since the hook it serves
 * needs a renderer and this needs nothing.
 */
export async function askHubWhoWeAre(hubUrl: string) {
  if (known.has(hubUrl) || asking.has(hubUrl)) return;
  asking.add(hubUrl);
  try {
    const state = await hubAccount({ hubUrl });
    update(hubUrl, { ...state, loading: false });
  } catch (e) {
    update(hubUrl, {
      loading: false,
      signedIn: false,
      account: null,
      problem: e instanceof Error ? e.message : String(e),
    });
  } finally {
    asking.delete(hubUrl);
  }
}

export function useHubAccount(hubUrl: string): HubAccount {
  const state = useSyncExternalStore(
    subscribe,
    useCallback(() => snapshot(hubUrl), [hubUrl]),
  );

  useEffect(() => {
    void askHubWhoWeAre(hubUrl);
  }, [hubUrl]);

  const signIn = useCallback(async () => {
    update(hubUrl, { busy: true, problem: null });
    try {
      const { account } = await hubSignIn({ hubUrl });
      update(hubUrl, { account, signedIn: true, loading: false });
    } catch (e) {
      update(hubUrl, { problem: e instanceof Error ? e.message : String(e) });
    } finally {
      update(hubUrl, { busy: false });
    }
  }, [hubUrl]);

  const signOut = useCallback(async () => {
    update(hubUrl, { busy: true, problem: null });
    try {
      await hubSignOut({ hubUrl });
      update(hubUrl, { account: null, signedIn: false, loading: false });
    } catch (e) {
      update(hubUrl, { problem: e instanceof Error ? e.message : String(e) });
    } finally {
      update(hubUrl, { busy: false });
    }
  }, [hubUrl]);

  return { ...state, signIn, signOut };
}

/** Forget every answer. For tests, which must not inherit each other's hubs. */
export function forgetHubAccounts() {
  known.clear();
  asking.clear();
}
