import { Link } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useHubAccount } from "../../account";
import { SignInButton, TryAgainButton } from "./AccountControl";

/**
 * Who you are on the hub, in the browse screen's header.
 *
 * Browsing and importing need no account, so this stays quiet: signed in, it is
 * a name with a green dot and nothing more, and pressing it opens a small
 * popover rather than a page (issue #2563). Signed out it offers the sign-in,
 * which is the whole point of it being here - the button used to live only in
 * Settings, so the answer to "how do I share something" was a page you had to
 * be told about.
 *
 * Signing out itself stays a deliberate act reached through the popover rather
 * than a bare header button: nobody signs out mid-browse, so it does not need
 * to be one press away, but a name that only linked out was a dead end for the
 * one person who does want to.
 *
 * Nothing renders until the first answer arrives, so the header does not flash a
 * sign-in button at somebody who is already signed in.
 */
export function HeaderAccount({ hubUrl }: { hubUrl: string }) {
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

  if (loading) return null;

  return (
    <div className="flex flex-col items-end justify-center gap-1">
      {unknown ? (
        // The check could not find out, which is nobody's fault and not a
        // sign-out (issue #1470). The reason is already below in red, so this
        // is the pair of ways out of it: ask again, or sign in regardless.
        <div className="flex items-center gap-2">
          <TryAgainButton onRecheck={recheck} />
          <SignInButton busy={busy} onSignIn={signIn} />
        </div>
      ) : signedIn ? (
        <AccountPill
          name={account?.name ?? null}
          busy={busy}
          onSignOut={signOut}
        />
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

/**
 * The signed-in state itself: a name with a green "signed in" dot, styled to
 * look pressable because it is one. The popover it opens holds the two things
 * signed in as somebody amounts to - the rest of the account, and leaving it -
 * rather than sending the whole press to Settings the way the header used to.
 */
function AccountPill({
  name,
  busy,
  onSignOut,
}: {
  name: string | null;
  busy: boolean;
  onSignOut: () => Promise<void>;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
        >
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-emerald-500"
          />
          {name ?? "Signed in"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <div className="flex flex-col">
          <Link
            to="/settings/hub"
            className="rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            Account and sharing settings
          </Link>
          <button
            type="button"
            onClick={() => void onSignOut()}
            disabled={busy}
            aria-busy={busy}
            className="rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-60"
          >
            Sign out
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
