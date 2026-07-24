import { Button } from "@picoframe/frame";
import { Check, Copy, Link as LinkIcon } from "lucide-react";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { buildImportCodeLink } from "@/deeplink/build";
import { copyDeepLink } from "@/deeplink/copyLink";

/**
 * Read-only display of a challenge or setup-pack code with a copy button -
 * the "Share challenge"/"Share pack" drawer content (issue #376). Also offers
 * a "Copy link" action that wraps the same code as a `coilbox://import?code=`
 * link (issue #498), for pasting somewhere a raw code would be mistaken for
 * noise - the link is an addition alongside the raw-code copy, not a
 * replacement for it.
 */
export function ChallengeCodeView({
  code,
  helpText,
}: {
  code: string;
  helpText: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable, so the code is still selectable in the box.
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
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => copyDeepLink(buildImportCodeLink(code))}
        >
          <LinkIcon className="mr-1.5 size-4" aria-hidden /> Copy link
        </Button>
      </div>
    </div>
  );
}
