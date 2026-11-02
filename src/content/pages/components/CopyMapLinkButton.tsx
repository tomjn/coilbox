import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Share2 } from "lucide-react";
import { buildMapLink } from "../../../deeplink/build";
import { copyDeepLink } from "../../../deeplink/copyLink";

/**
 * Copies a `coilbox://open?screen=map` link for this map (issue #286). The link
 * carries the map's exact name and needs no hub. Pasted into a chat it becomes a
 * map card, and anywhere else it opens the map's page in coilbox.
 */
export function CopyMapLinkButton({
  mapName,
  className,
  labelled = false,
}: {
  mapName: string;
  className?: string;
  /** Says "Copy link" beside the icon, for a row of labelled buttons. */
  labelled?: boolean;
}) {
  const { t } = useLingui();
  const copy = () => void copyDeepLink(buildMapLink(mapName));
  if (labelled) {
    return (
      <Button
        size="sm"
        variant="outline"
        className={className ?? "gap-1.5"}
        onClick={copy}
      >
        <Share2 className="size-4" /> <Trans>Copy link</Trans>
      </Button>
    );
  }
  const label = t`Copy a link to ${mapName}`;
  return (
    <Button
      size="sm"
      variant="ghost"
      className={className}
      aria-label={label}
      title={label}
      onClick={copy}
    >
      <Share2 className="size-4" />
    </Button>
  );
}
