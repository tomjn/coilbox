import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { useEffect, useRef, useState } from "react";
import { openExternal } from "@/home/navItem";
import { signInToHub, useHubAccount } from "@/hub/account";
import { useHubUrl } from "@/hub/config";
import { SignInButton } from "@/hub/pages/components/AccountControl";
import { WIZARD_TITLE_ID } from "../ids";
import { PageArt } from "./PageArt";
import type { WizardPageProps } from "./registry";

/**
 * What the hub is for, the same sign in button the hub screen uses, and a
 * button that opens the hub in the browser, in one column centred on the left
 * over the hub's drawing. The page draws its own heading so it can sit in that
 * column. Only this page's own attempt decides what happens, because the shared
 * store can already hold a failed account check or an earlier sign in. A sign
 * in that finishes after the player has moved on does not move the wizard a
 * second time.
 */
export default function HubPage({ next }: WizardPageProps) {
  const { t } = useLingui();
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
    <div className="relative flex min-h-full items-center py-6">
      <PageArt toolId="hub.browse" />
      {/* Positioned, so it paints over the drawing without a z-index. */}
      <div
        data-testid="hub-column"
        className="relative flex max-w-md flex-col items-start gap-4"
      >
        <h2
          id={WIZARD_TITLE_ID}
          className="text-3xl font-semibold tracking-tight"
        >
          {t`Sign in to the hub`}
        </h2>
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
        <div className="flex flex-wrap gap-2.5">
          <SignInButton
            busy={busy}
            onSignIn={signInThenNext}
            size="default"
            variant="default"
          />
          <Button variant="outline" onClick={() => openExternal(hubUrl)}>
            {t`Open the hub`}
          </Button>
        </div>
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
    </div>
  );
}
