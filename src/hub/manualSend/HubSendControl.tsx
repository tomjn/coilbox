import { useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUp, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { CoilboxGlyph } from "@/components/CoilboxGlyph";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useHubAccount } from "../account";
import { useRunningSendFor } from "../assets/runningUploads";
import { useHubUrl } from "../config";
import { SignInButton } from "../pages/components/AccountControl";
import type { SendSubject } from "./grant";
import { startManualSend } from "./run";
import type { HubPresence } from "./status";

/**
 * A button that opens an item's page on the hub in the browser. The pages place
 * it themselves, since a game puts it among its links rather than beside Play.
 */
export function HubPageButton({ url, label }: { url: string; label: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      className="gap-1.5"
      onClick={() => openUrl(url).catch(() => {})}
    >
      <CoilboxGlyph size={16} />
      {label}
      <ExternalLink className="size-4" aria-hidden />
    </Button>
  );
}

/**
 * The hub send control on a map or game's detail page. It shows only while the
 * hub is missing the item, or some of a map's layers, or a send of it is
 * running. When the hub has it, the page shows a {@link HubPageButton} instead,
 * and beside this control for a map that is missing layers.
 *
 * Pressing it is the agreement to send this one item, so the uploads switch in
 * the Share panel is not involved. Somebody signed out is offered the sign in
 * first, and the send starts once they are signed in.
 */
export function HubSendControl({
  subject,
  label,
  presence,
  enginePath,
  dataDir,
}: {
  subject: SendSubject;
  label: string;
  presence: HubPresence;
  /** The install the page is showing, which is the one that gets read. */
  enginePath?: string;
  dataDir?: string;
}) {
  const { t } = useLingui();
  const hubUrl = useHubUrl();
  const account = useHubAccount(hubUrl);
  const key = subject.kind === "game" ? subject.shortname : subject.map_name;
  const running = useRunningSendFor(subject.kind, key);
  const [signingIn, setSigningIn] = useState(false);

  const send = () => {
    if (!enginePath || !dataDir) return;
    void startManualSend({
      hubUrl,
      enginePath,
      dataDir,
      subject,
      label,
    });
  };

  // The popover is open because they pressed send while signed out. Once the
  // sign in lands, the send they asked for goes ahead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires on the sign in landing, not on every render's new `send`
  useEffect(() => {
    if (signingIn && account.signedIn) {
      setSigningIn(false);
      send();
    }
  }, [signingIn, account.signedIn]);

  const icons = (text: string) => (
    <>
      <CoilboxGlyph size={16} />
      {text}
      <ArrowUp className="size-4" aria-hidden />
    </>
  );

  if (running) {
    return (
      <Button size="sm" variant="outline" className="gap-1.5" disabled>
        {icons(t`Sending…`)}
      </Button>
    );
  }
  const wanted =
    presence.state === "missing" || presence.state === "incomplete";
  if (!wanted || !enginePath || !dataDir) return null;
  if (account.signedIn) {
    return (
      <Button size="sm" variant="outline" className="gap-1.5" onClick={send}>
        {icons(t`Send to hub`)}
      </Button>
    );
  }
  return (
    <Popover open={signingIn} onOpenChange={setSigningIn}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          {icons(t`Send to hub`)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto">
        <SignInButton
          hubUrl={hubUrl}
          busy={account.busy}
          onSignIn={account.signIn}
        />
      </PopoverContent>
    </Popover>
  );
}
