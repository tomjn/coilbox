import { Button } from "@picoframe/frame";
import { useCallback, useEffect, useState } from "react";
import {
  type HubIdentity,
  hubAccount,
  hubSignIn,
  hubSignOut,
} from "../../auth";

/**
 * Signing in to the hub, in Settings > Coilbox hub (issue #1348).
 *
 * Here rather than on the browse screen because browsing needs no account at all.
 * Signing in is for publishing, and publishing starts from the thing being shared,
 * so this is a setting you visit once rather than a control anybody needs to hand.
 *
 * The whole section is behind `isHubEnabled`, so a distribution that switched the
 * hub off has no way to reach this.
 *
 * No token is on this side of the boundary. The Rust plugin keeps the refresh token
 * in the OS keychain and the access token in memory, and answers only with who is
 * signed in.
 */
export function AccountControl({ hubUrl }: { hubUrl: string }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<HubIdentity | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: { cancelled: boolean }) => {
      setLoading(true);
      try {
        const state = await hubAccount({ hubUrl });
        if (signal?.cancelled) return;
        setSignedIn(state.signedIn);
        setAccount(state.account);
        setProblem(state.problem);
      } catch (e) {
        if (signal?.cancelled) return;
        setSignedIn(false);
        setAccount(null);
        setProblem(e instanceof Error ? e.message : String(e));
      } finally {
        if (!signal?.cancelled) setLoading(false);
      }
    },
    [hubUrl],
  );

  // Each hub is a separate account, so changing the address asks the new one.
  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  const signIn = async () => {
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
  };

  const signOut = async () => {
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
  };

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium leading-none">Your hub account</h3>
      {loading ? (
        <p className="text-sm text-muted-foreground">
          Checking whether you are signed in.
        </p>
      ) : signedIn ? (
        <>
          <p className="text-sm text-muted-foreground">
            {account
              ? `Signed in as ${account.name}.`
              : "Signed in. Coilbox could not check the name this time."}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={signOut}
            disabled={busy}
            aria-busy={busy}
          >
            Sign out
          </Button>
          <p className="text-xs leading-snug text-muted-foreground">
            Signing out only affects this computer. It does not remove anything
            you have already shared.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            You need an account to share things on the hub. Browsing and
            importing need no account.
          </p>
          <Button size="sm" onClick={signIn} disabled={busy} aria-busy={busy}>
            {busy ? "Waiting for your browser" : "Sign in with Discord"}
          </Button>
          {busy && (
            <p className="text-xs leading-snug text-muted-foreground">
              Finish signing in the browser window that opened. Coilbox stops
              waiting after a minute.
            </p>
          )}
        </>
      )}
      {problem && <p className="text-sm text-destructive">{problem}</p>}
    </section>
  );
}
