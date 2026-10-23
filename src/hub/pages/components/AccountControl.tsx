import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, cn } from "@picoframe/frame";
import { RotateCw } from "lucide-react";
import { useHubAccount, useHubProviders } from "../../account";
import { ProviderLogo, providerColours, providerName } from "./ProviderLogo";

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
  const { t, i18n } = useLingui();
  const accountName = account?.name;

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium leading-none">
        <Trans>Your hub account</Trans>
      </h3>
      {loading ? (
        <p className="text-sm text-muted-foreground">
          <Trans>Checking whether you are signed in.</Trans>
        </p>
      ) : signedIn ? (
        <>
          <p className="text-sm text-muted-foreground">
            {accountName
              ? t`Signed in as ${accountName}.`
              : t`Signed in. Coilbox could not check the name this time.`}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void signOut()}
            disabled={busy}
            aria-busy={busy}
          >
            <Trans>Sign out</Trans>
          </Button>
          <p className="text-xs leading-snug text-muted-foreground">
            <Trans>
              Signing out only affects this computer. It does not remove
              anything you have already shared.
            </Trans>
          </p>
        </>
      ) : unknown ? (
        // The check failed, so this is not a signed-out reader and must not be
        // told what an account is for (issue #1470). Settings is where somebody
        // goes to sort their account out, and it was the one place that could
        // not ask the question again. The sign-in stays beside it, because it
        // works whatever the keychain said a moment ago.
        <>
          <p className="text-sm text-muted-foreground">
            {i18n._(COULD_NOT_CHECK)}
          </p>
          <div className="flex flex-wrap gap-2">
            <TryAgainButton onRecheck={recheck} />
            <SignInButton
              hubUrl={hubUrl}
              busy={busy}
              onSignIn={signIn}
              size="sm"
            />
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            <Trans>
              You need an account to share things on the hub. Browsing and
              importing need no account.
            </Trans>
          </p>
          <SignInButton
            hubUrl={hubUrl}
            busy={busy}
            onSignIn={signIn}
            size="sm"
            variant="default"
          />
          {busy && (
            <p className="text-xs leading-snug text-muted-foreground">
              <Trans>
                Finish signing in the browser window that opened. Coilbox stops
                waiting after a minute.
              </Trans>
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
export const COULD_NOT_CHECK = msg`Coilbox could not tell whether you are signed in.`;

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
      <RotateCw className="mr-1.5 size-4" aria-hidden />{" "}
      <Trans>Try again</Trans>
    </Button>
  );
}

/**
 * The sign-in buttons, wherever they are offered: one per provider the hub
 * lists, in its order (issue #2979), in the provider's own colour with its mark
 * the way the hub shows them. Each label says what the press does next -
 * a browser window opens and the sign-in finishes there - because that is the
 * surprising part of pressing it.
 *
 * While a sign-in is in flight the row becomes one button saying the app is
 * waiting, which is the only sign it has not frozen during the minute the
 * browser has. Nothing renders until the hub has said which providers it has,
 * so nobody is offered one the hub then refuses.
 */
export function SignInButton({
  hubUrl,
  busy,
  onSignIn,
  size = "sm",
  variant = "outline",
}: {
  hubUrl: string;
  busy: boolean;
  onSignIn: (provider: string) => Promise<void>;
  size?: "sm" | "default";
  variant?: "default" | "outline";
}) {
  const { t } = useLingui();
  const providers = useHubProviders(hubUrl);
  if (busy) {
    return (
      <Button size={size} variant={variant} disabled aria-busy>
        {t`Waiting for your browser`}
      </Button>
    );
  }
  if (!providers) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {providers.map((provider) => {
        const name = providerName(provider);
        const colours = providerColours(provider);
        return (
          <Button
            key={provider}
            size={size}
            variant={colours ? "default" : variant}
            className={cn(colours && cn("text-white", colours))}
            onClick={() => void onSignIn(provider)}
          >
            <ProviderLogo provider={provider} />
            {t`Sign in with ${name}`}
          </Button>
        );
      })}
    </div>
  );
}
