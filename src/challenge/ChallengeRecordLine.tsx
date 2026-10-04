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
  const { records, clear } = useChallengeRecords();
  const [open, setOpen] = useState(false);
  const record = records[identity];
  if (!record) return null;
  return (
    <div className={`flex items-center gap-1 text-xs ${className ?? ""}`}>
      <span>{recordSummary(record)}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Clear the record for this challenge"
          >
            <RotateCcw className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Clear the record for this challenge? That forgets{" "}
              {record.attempts} {record.attempts === 1 ? "attempt" : "attempts"}{" "}
              and the best result. Your runs stay.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Keep it
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  clear(identity);
                }}
              >
                Clear record
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
