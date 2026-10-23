import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { signInToHub, useHubAccount } from "@/hub/account";
import { useHubUrl } from "@/hub/config";
import { SignInButton } from "@/hub/pages/components/AccountControl";
import type { WizardPageProps } from "./registry";

/**
 * What the hub is for, and the same sign in button the hub screen uses. Only
 * this page's own attempt decides what happens, because the shared store can
 * already hold a failed account check or an earlier sign in. A sign in that
 * finishes after the player has moved on does not move the wizard a second
 * time.
 */
export default function HubPage({ next }: WizardPageProps) {
  const hubUrl = useHubUrl();
  const { busy } = useHubAccount(hubUrl);
  const [failure, setFailure] = useState<string | null>(null);
  const shown = useRef(true);

  useEffect(() => {
    shown.current = true;
    return () => {
      shown.current = false;
    };
  }, []);

  const signInThenNext = async () => {
    setFailure(null);
    const failed = await signInToHub(hubUrl);
    if (!shown.current) return;
    if (failed) setFailure(failed);
    else next();
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
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
    </div>
  );
}
