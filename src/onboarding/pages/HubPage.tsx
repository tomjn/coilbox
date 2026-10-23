import { Trans } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { hubAccountSnapshot, useHubAccount } from "@/hub/account";
import { useHubUrl } from "@/hub/config";
import { SignInButton } from "@/hub/pages/components/AccountControl";
import type { WizardPageProps } from "./registry";

/**
 * What the hub is for, and the same sign in button the hub screen uses. The
 * store catches a failed sign in into `problem`, so success is read back from
 * it. A sign in that finishes after the player has moved on does not move the
 * wizard a second time.
 */
export default function HubPage({ next }: WizardPageProps) {
  const hubUrl = useHubUrl();
  const { busy, problem, signIn } = useHubAccount(hubUrl);
  const shown = useRef(true);

  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);

  const signInThenNext = async () => {
    await signIn();
    if (shown.current && hubAccountSnapshot(hubUrl).signedIn) next();
  };

  return (
    <div className="flex max-w-md flex-col items-start gap-4">
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          <Trans>Publish maps, scenarios and presets</Trans>
        </li>
        <li>
          <Trans>Import anything shared from a hub link</Trans>
        </li>
        <li>
          <Trans>Keep your uploads under one name</Trans>
        </li>
      </ul>
      <SignInButton
        busy={busy}
        onSignIn={signInThenNext}
        size="default"
        variant="default"
      />
      {busy && (
        <p className="text-xs text-muted-foreground">
          <Trans>Finish signing in the browser window that opened.</Trans>
        </p>
      )}
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
