import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { CORE_PRIME_URL } from "../../home/zones/OpenAnnihilationCard";
import { playOaCheck } from "../../play/bindings";
import { useOpenAnnihilation } from "../openAnnihilation";

/**
 * The engine card of an Open Annihilation battle (issue #4947): the host's OA
 * version beside the player's own, as information. OA's room turns a player away
 * for a version it does not take, so nothing here compares them or offers a
 * download. A player with no OA is pointed at Core Prime instead.
 *
 * The stored version line goes stale because OA updates itself, so the player's
 * own version is read from the program each time the card opens.
 */
export function OaEngineCard({
  hostVersion,
  hosting = false,
}: {
  hostVersion: string;
  /** The player is the host, so the host's version is their own and one row
   * says it (issue #4964). */
  hosting?: boolean;
}) {
  const { t } = useLingui();
  const [program] = useOpenAnnihilation();
  const path = program?.path ?? null;
  const [mine, setMine] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState(false);

  useEffect(() => {
    setMine(null);
    setUnreadable(false);
    if (!path) return;
    let current = true;
    playOaCheck({ path }).then(
      (found) => current && setMine(found.version),
      () => current && setUnreadable(true),
    );
    return () => {
      current = false;
    };
  }, [path]);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-card p-4 text-sm">
      <span className="font-semibold">
        <Trans>Engine</Trans>
      </span>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {!hosting && (
          <>
            <dt className="text-muted-foreground">
              <Trans>Host</Trans>
            </dt>
            <dd className="break-words">
              {hostVersion.trim() || t`Not given by the lobby`}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">
          {hosting ? <Trans>Version</Trans> : <Trans>Yours</Trans>}
        </dt>
        <dd className="break-words">
          {!path ? t`None` : unreadable ? t`Unknown` : (mine ?? t`Checking…`)}
        </dd>
      </dl>
      {!path && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => void openUrl(CORE_PRIME_URL).catch(() => {})}
        >
          <ExternalLink className="size-4" />
          <Trans>Get Open Annihilation</Trans>
        </Button>
      )}
    </div>
  );
}
