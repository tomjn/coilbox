import { Button } from "@picoframe/frame";
import {
  Film,
  HelpCircle,
  RefreshCw,
  SlidersHorizontal,
  Trophy,
  X,
  XCircle,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";
import { Link } from "react-router";
import { formatDuration, HANDICAP_TWEAKS } from "@/play/debrief";
import type { SkirmishDebrief } from "@/play/useSkirmishDebrief";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { SkirmishDraft } from "../../drafts";
import { SaveAsPresetButton } from "./SaveAsPresetButton";

/**
 * Post-skirmish debrief (#370): outcome, duration and a link to the fresh
 * replay, plus Rematch / Rematch with a tweak / Save as preset. Styled as a
 * right-hand sheet — matching `PresetsDrawer` — rather than a modal dialog,
 * per the repo's drawers-over-dialogs preference.
 */
export function DebriefDrawer({
  open,
  onOpenChange,
  debrief,
  onRematch,
  onRematchWithTweak,
  getDraft,
  defaultPresetName,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  debrief: SkirmishDebrief | null;
  onRematch: () => void;
  onRematchWithTweak: (deltaPercent: number) => void;
  getDraft: () => SkirmishDraft | null;
  defaultPresetName: string;
  disabled?: boolean;
}) {
  const [tweak, setTweak] = useState(HANDICAP_TWEAKS[1].value);

  if (!debrief) return null;

  const { outcome, headline, durationSec, replayFilename } = debrief;
  const Icon =
    outcome === "victory"
      ? Trophy
      : outcome === "defeat"
        ? XCircle
        : HelpCircle;
  const iconClass =
    outcome === "victory"
      ? "text-amber-400"
      : outcome === "defeat"
        ? "text-destructive"
        : "text-muted-foreground";

  const rematchWithTweak = () => {
    const delta = HANDICAP_TWEAKS.find((t) => t.value === tweak)?.delta ?? 0;
    onRematchWithTweak(delta);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              Match debrief
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
            <div className="flex items-start gap-3">
              <Icon className={`size-8 shrink-0 ${iconClass}`} aria-hidden />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">{headline}</p>
                <p className="text-xs text-muted-foreground">
                  Duration:{" "}
                  {durationSec != null
                    ? formatDuration(durationSec)
                    : "unknown"}
                </p>
              </div>
            </div>

            {replayFilename ? (
              <Link
                to={`/play/replays/${encodeURIComponent(replayFilename)}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                <Film className="size-4" /> View replay
              </Link>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Film className="size-4" /> No replay available for this match.
              </p>
            )}

            <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
              <Button
                onClick={onRematch}
                disabled={disabled}
                className="gap-1.5"
              >
                <RefreshCw className="size-4" /> Rematch
              </Button>

              <div className="flex flex-col gap-2">
                <OptionSelect
                  value={tweak}
                  onValueChange={setTweak}
                  options={HANDICAP_TWEAKS.map((t) => ({
                    value: t.value,
                    label: t.label,
                  }))}
                  size="sm"
                  className="w-full"
                />
                <Button
                  variant="outline"
                  onClick={rematchWithTweak}
                  disabled={disabled}
                  className="w-full gap-1.5"
                >
                  <SlidersHorizontal className="size-4" /> Rematch with tweak
                </Button>
              </div>

              <SaveAsPresetButton
                getDraft={getDraft}
                defaultName={defaultPresetName}
                disabled={disabled}
                variant="outline"
              />
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
