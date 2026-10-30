import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { describeError } from "@/i18n/uiError";

/**
 * Put a game's own widgets back to their defaults. The first click asks. The
 * game's config file is copied first, and the widgets' saved settings stay.
 */
export function ResetGameWidgets({
  game,
  running,
  onReset,
}: {
  game: string;
  /** A game is running, which would write the file back when it exits. */
  running: boolean;
  onReset: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = (next: boolean) => {
    setOpen(next);
    setError(null);
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await onReset();
      setOpen(false);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={running}
          aria-label={t`Reset ${game}'s own widgets`}
        >
          <RotateCcw />
          <Trans>Reset</Trans>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <h3 className="break-words text-sm font-medium">
          {t`Put ${game}'s own widgets back to their defaults?`}
        </h3>
        {error && (
          <p role="alert" className="break-words text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => change(false)}
          >
            <Trans>Cancel</Trans>
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void reset()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            <Trans>Reset</Trans>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
