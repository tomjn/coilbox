import { Button } from "@picoframe/frame";
import { RotateCw } from "lucide-react";
import { useHubAccount } from "../../account";

/**
 * Signing in to the hub, in Settings > Coilbox hub (issue #1348).
 *
 * Settings holds the full account: who you are, and signing out. Signing in
 * itself is also offered where it comes up - the hub screen's header and the
 * publish form - because a sign-in button nobody can find is a sign-in nobody
 * does. All three read the same state through `useHubAccount`.
 *
 * The whole section is behind `isHubEnabled`, so a distribution that switched the
 * hub off has no way to reach this.
 *
 * No token is on this side of the boundary. The Rust plugin keeps the refresh token
 * in the OS keychain and the access token in memory, and answers only with who is
 * signed in.
 */
export function AccountControl({ hubUrl }: { hubUrl: string }) {
  const {
    loading,
    busy,
    signedIn,
    unknown,
    account,
    problem,
    recheck,
    signIn,
    signOut,
  } = useHubAccount(hubUrl);

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
            onClick={() => void signOut()}
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
      ) : unknown ? (
        // The check failed, so this is not a signed-out reader and must not be
        // told what an account is for (issue #1470). Settings is where somebody
        // goes to sort their account out, and it was the one place that could
        // not ask the question again. The sign-in stays beside it, because it
        // works whatever the keychain said a moment ago.
        <>
          <p className="text-sm text-muted-foreground">{COULD_NOT_CHECK}</p>
          <div className="flex flex-wrap gap-2">
            <TryAgainButton onRecheck={recheck} />
            <SignInButton busy={busy} onSignIn={signIn} size="sm" />
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            You need an account to share things on the hub. Browsing and
            importing need no account.
          </p>
          <SignInButton
            busy={busy}
            onSignIn={signIn}
            size="sm"
            variant="default"
          />
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

/**
 * What a failed check amounts to, in one sentence. The reason itself is shown
 * beside it where there is room: this is what it means, not what went wrong.
 *
 * Written once because all three surfaces say it, and because the difference
 * between this and "you are signed out" is the whole point of the state.
 */
export const COULD_NOT_CHECK =
  "Coilbox could not tell whether you are signed in.";

/**
 * The one way out of a check that could not find out (issues #1456, #1470).
 *
 * The answer is kept for the session, so without this the only ways past it are
 * signing in or restarting coilbox. Whatever was in the way, usually a keychain
 * that did not answer inside its ten seconds, is often gone by the time somebody
 * reads the sentence.
 */
export function TryAgainButton({
  onRecheck,
  size = "sm",
  variant = "outline",
  className,
}: {
  onRecheck: () => Promise<void>;
  size?: "sm" | "default";
  variant?: "default" | "outline";
  className?: string;
}) {
  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      onClick={() => void onRecheck()}
    >
      <RotateCw className="mr-1.5 size-4" aria-hidden /> Try again
    </Button>
  );
}

/**
 * The one sign-in button, wherever it is offered. Its label says what the press
 * does next - a browser window opens and the sign-in finishes there - because
 * that is the surprising part of pressing it.
 */
export function SignInButton({
  busy,
  onSignIn,
  size = "sm",
  variant = "outline",
}: {
  busy: boolean;
  onSignIn: () => Promise<void>;
  size?: "sm" | "default";
  variant?: "default" | "outline";
}) {
  return (
    <Button
      size={size}
      variant={variant}
      onClick={() => void onSignIn()}
      disabled={busy}
      aria-busy={busy}
    >
      {busy ? "Waiting for your browser" : "Sign in with Discord"}
    </Button>
  );
}
