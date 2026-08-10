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
 * Each hub is a separate account, so changing the address asks the new one.
 *
 * No token is on this side of the boundary. The Rust plugin keeps the refresh
 * token in the OS keychain and the access token in memory, and answers only with
 * who is signed in. See `./auth`.
 */

import { useCallback, useEffect, useState } from "react";
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

export function useHubAccount(hubUrl: string): HubAccount {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [account, setAccount] = useState<HubIdentity | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const signal = { cancelled: false };
    setLoading(true);
    void (async () => {
      try {
        const state = await hubAccount({ hubUrl });
        if (signal.cancelled) return;
        setSignedIn(state.signedIn);
        setAccount(state.account);
        setProblem(state.problem);
      } catch (e) {
        if (signal.cancelled) return;
        setSignedIn(false);
        setAccount(null);
        setProblem(e instanceof Error ? e.message : String(e));
      } finally {
        if (!signal.cancelled) setLoading(false);
      }
    })();
    return () => {
      signal.cancelled = true;
    };
  }, [hubUrl]);

  const signIn = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      const { account: identity } = await hubSignIn({ hubUrl });
      setAccount(identity);
      setSignedIn(true);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [hubUrl]);

  const signOut = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      await hubSignOut({ hubUrl });
      setAccount(null);
      setSignedIn(false);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [hubUrl]);

  return { loading, busy, signedIn, account, problem, signIn, signOut };
}
