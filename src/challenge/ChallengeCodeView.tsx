import { Button } from "@picoframe/frame";
import { Check, Copy, Download, Globe, Link as LinkIcon } from "lucide-react";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { buildImportCodeLink } from "@/deeplink/build";
import { copyDeepLink } from "@/deeplink/copyLink";
import { openExternal } from "@/home/navItem";
import { useHubUrl } from "@/hub/config";
import { isHubEnabled } from "@/profile/profile";
import { ErrorBanner } from "../content/pages/components/states";

/**
 * Read-only display of a challenge or setup-pack code with a copy button -
 * the "Share challenge"/"Share pack" drawer content (issue #376). Also offers
 * a "Copy link" action that wraps the same code as a `coilbox://import?code=`
 * link (issue #498), for pasting somewhere a raw code would be mistaken for
 * noise - the link is an addition alongside the raw-code copy, not a
 * replacement for it, and it is dropped when the code is too long for one.
 *
 * `onExportFile` (issue #476) adds a third action that saves the container as
 * a `.json` file instead, for larger payloads or where pasting a long code is
 * awkward. It's optional so callers that only ever produce a code (setup
 * packs, today) don't gain a button with nothing behind it - the caller owns
 * the save dialog and the actual write, this component only surfaces busy and
 * error state around it.
 *
 * "Copy code and open hub" (issue #1346) needs nothing from the caller: unlike
 * `onExportFile`, every caller wants the identical action on the identical
 * `code` prop it already has, so it lives here rather than threaded in. It is
 * not the real publish flow (issue #1349, blocked on the hub growing a POST
 * endpoint) - it copies the code and opens the hub's publish page in the
 * system browser, leaving the actual pasting to the user. Gated on
 * `isHubEnabled()` so a distributor can turn the hub off entirely.
 */
export function ChallengeCodeView({
  code,
  helpText,
  onExportFile,
}: {
  code: string;
  helpText: string;
  /** Save the challenge as a file. Resolves once the dialog is dismissed
   * (including a no-op resolve when the user cancels it). */
  onExportFile?: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const hubUrl = useHubUrl();

  // A link caps the code at `MAX_CODE_LENGTH`, well below what a pasted code may
  // be, because a URL passes through software that truncates long ones. A
  // scenario carrying dialogue clips clears the code ceiling and misses this one
  // routinely (issue #1336), so the button goes rather than handing out a link
  // that would not parse back.
  const link = buildImportCodeLink(code);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable, so the code is still selectable in the box.
    }
  };

  // Same clipboard write as `copy`, called directly from the click handler so
  // it stays inside the user gesture macOS requires for a clipboard write - an
  // effect or a `.then` continuation loses it. The hub page opens regardless of
  // whether the write succeeded: the code is still in the box above to copy by
  // hand.
  const publishToHub = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // clipboard may be unavailable, so the code is still selectable in the box.
    }
    openExternal(`${hubUrl}/publish`);
  };

  const exportFile = async () => {
    if (!onExportFile) return;
    setFileError(null);
    setFileBusy(true);
    try {
      await onExportFile();
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    } finally {
      setFileBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-sm text-muted-foreground">{helpText}</p>
      <Textarea
        readOnly
        value={code}
        rows={6}
        className="font-mono text-xs"
        onFocus={(e) => e.currentTarget.select()}
      />
      {fileError && <ErrorBanner message={fileError} />}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={copy}>
          {copied ? (
            <>
              <Check className="mr-1.5 size-4" aria-hidden /> Copied
            </>
          ) : (
            <>
              <Copy className="mr-1.5 size-4" aria-hidden /> Copy code
            </>
          )}
        </Button>
        {link && (
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => copyDeepLink(link)}
          >
            <LinkIcon className="mr-1.5 size-4" aria-hidden /> Copy link
          </Button>
        )}
      </div>
      {!link && (
        <p className="text-xs text-muted-foreground">
          Too long to share as a <code>coilbox://</code> link. Copy the code
          itself, or export it as a file.
        </p>
      )}
      {onExportFile && (
        <Button variant="outline" onClick={exportFile} disabled={fileBusy}>
          <Download className="mr-1.5 size-4" aria-hidden />
          {fileBusy ? "Exporting…" : "Export as file"}
        </Button>
      )}
      {isHubEnabled() && (
        <div className="flex flex-col gap-1.5 border-t pt-3">
          <Button variant="outline" onClick={publishToHub}>
            <Globe className="mr-1.5 size-4" aria-hidden /> Copy code & open hub
          </Button>
          <p className="text-xs text-muted-foreground">
            Copies the code to your clipboard, then opens the hub's publish page
            in your browser. Coilbox doesn't upload anything itself - paste the
            code in there to finish.
          </p>
        </div>
      )}
    </div>
  );
}
