import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatBytes } from "@/lib/format";
import { notify } from "@/notify/notify";
import { contentDeleteEngine, type EngineUsage } from "../../bindings";

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/**
 * Confirm-then-delete for one installed engine (issue #386). Stale engine
 * versions are one of the two things quietly filling a player's disk, and until
 * now nothing in coilbox removed one.
 *
 * The preferred engine is never deletable: it is what every launch uses, so
 * removing it breaks play until another is picked. The caller says so via
 * `blockReason` rather than hiding the button, so the reason is readable.
 *
 * An engine that recorded into its own folder holds replays (see #971), and
 * deleting the folder takes them. When that is the case the confirmation says so
 * and points at Gather replays, which moves them out first.
 */
export function DeleteEngineButton({
  engine,
  blockReason,
  onDeleted,
}: {
  engine: EngineUsage;
  /** Why this engine cannot go, which also disables the button. */
  blockReason?: string;
  /** Re-read the breakdown, which is now short one engine. */
  onDeleted: () => void;
}) {
  const { t: tr } = useLingui();
  const version = engine.version;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function del() {
    setPending(true);
    setError(null);
    try {
      const { bytes } = await contentDeleteEngine({ path: engine.path });
      const freed = formatBytes(bytes);
      void notify({
        title: freed
          ? t`Deleted engine ${version}, freeing ${freed}.`
          : t`Deleted engine ${version}.`,
        level: "success",
      });
      setOpen(false);
      onDeleted();
    } catch (e) {
      setError(msg(e));
    } finally {
      setPending(false);
    }
  }

  const freedBytes = formatBytes(engine.bytes) ?? "0 B";
  const replayBytes = formatBytes(engine.replayBytes);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!!blockReason}
          title={blockReason ?? tr`Delete engine ${version}`}
        >
          <Trash2 className="size-4" />
          <Trans>Delete</Trans>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">
            <Trans>Delete engine {version}?</Trans>
          </h3>
          <p className="text-xs text-muted-foreground">
            <Trans>
              The whole folder goes, freeing {freedBytes}. You would have to
              download this version again to replay a game recorded on it.
            </Trans>
          </p>
          {engine.replayBytes > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              <Trans>
                This engine recorded {replayBytes} of replays into its own
                folder, which go with it. Move them out first with Gather
                replays on the{" "}
                <Link
                  to="/play/replays"
                  className="underline underline-offset-4"
                >
                  Replays screen
                </Link>
                .
              </Trans>
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            <Trans>Cancel</Trans>
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={del}
            disabled={pending}
            className="gap-1.5"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            <Trans>Delete</Trans>
          </Button>
        </div>
        {error && (
          <p className="break-words text-xs text-destructive">{error}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
