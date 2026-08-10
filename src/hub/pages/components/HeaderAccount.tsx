import { useHubAccount } from "../../account";
import { SignInButton } from "./AccountControl";

/**
 * Who you are on the hub, in the browse screen's header.
 *
 * Browsing and importing need no account, so this is deliberately quiet: signed
 * in, it is a line of muted text and nothing to press. Signed out it offers the
 * sign-in, which is the whole point of it being here - the button used to live
 * only in Settings, so the answer to "how do I share something" was a page you
 * had to be told about.
 *
 * Signing out stays in Settings. It is not something anybody does mid-browse,
 * and a control that can log you out does not belong next to a search box.
 *
 * Nothing renders until the first answer arrives, so the header does not flash a
 * sign-in button at somebody who is already signed in.
 */
export function HeaderAccount({ hubUrl }: { hubUrl: string }) {
  const { loading, busy, signedIn, account, problem, signIn } =
    useHubAccount(hubUrl);

  if (loading) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      {signedIn ? (
        <p className="text-xs text-muted-foreground">
          {account ? `Signed in as ${account.name}` : "Signed in"}
        </p>
      ) : (
        <SignInButton busy={busy} onSignIn={signIn} />
      )}
      {busy && (
        <p className="max-w-xs text-right text-xs text-muted-foreground">
          Finish signing in the browser window that opened.
        </p>
      )}
      {problem && (
        <p className="max-w-xs text-right text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
