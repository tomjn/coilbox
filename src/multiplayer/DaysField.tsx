import { Trans, useLingui } from "@lingui/react/macro";
import { cn, Input } from "@picoframe/frame";

/**
 * The `days` field uberserver's `BAN` and `BANSPECIFIC` take: a plain
 * number, decimals allowed (uberserver runs `float(duration)` on it and
 * refuses anything else), never a ChanServ-style span like `7d` (issue
 * #2774 fixed the chat member menu's "Ban from server" form to send this
 * shape rather than a span, and issue #2778's Server admin bans form shares
 * it rather than writing a second one).
 */
export function DaysField({
  value,
  onChange,
  className,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  autoFocus?: boolean;
}) {
  const { t } = useLingui();
  return (
    <span
      className={cn(
        "flex flex-col gap-1 text-xs text-muted-foreground",
        className,
      )}
    >
      <Trans>Days</Trans>
      <Input
        type="number"
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t`e.g. 0.5, 1, 7`}
        aria-label={t`Days`}
        className="h-8"
        autoFocus={autoFocus}
      />
    </span>
  );
}
