import { Trans } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Loader2 } from "lucide-react";

/**
 * The Send button on each row of the hub's sharing list. It says only "Send",
 * since the row's name says what is sent, and `label` names it in full for a
 * screen reader, starting with the same word. While a run is going it spins
 * and stays disabled, and the row's description says how far it has got.
 */
export function SendButton({
  label,
  running,
  disabled,
  onClick,
}: {
  label: string;
  running: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClick}
      disabled={running || disabled}
      aria-busy={running || undefined}
      aria-label={label}
    >
      {running && <Loader2 className="size-4 animate-spin" aria-hidden />}
      <Trans>Send</Trans>
    </Button>
  );
}
