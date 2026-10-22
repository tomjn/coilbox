import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { recordSummary } from "./record";
import { useChallengeRecords } from "./useChallengeRecords";

/**
 * Your best result and attempt count for a challenge, or nothing when none is
 * recorded. Clearing asks first, in a popover, because it cannot be undone.
 */
export function ChallengeRecordLine({
  identity,
  className,
}: {
  identity: string;
  className?: string;
}) {
  const { t } = useLingui();
  const { records, clear } = useChallengeRecords();
  const [open, setOpen] = useState(false);
  const record = records[identity];
  if (!record) return null;
  const attemptCount = record.attempts;
  return (
    <div className={`flex items-center gap-1 text-xs ${className ?? ""}`}>
      <span>{recordSummary(record)}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t`Clear the record for this challenge`}
          >
            <RotateCcw className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {plural(attemptCount, {
                one: "Clear the record for this challenge? That forgets # attempt and the best result. Your runs stay.",
                other:
                  "Clear the record for this challenge? That forgets # attempts and the best result. Your runs stay.",
              })}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
              >
                <Trans>Keep it</Trans>
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  clear(identity);
                }}
              >
                <Trans>Clear record</Trans>
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
