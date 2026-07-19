import { Button, Input } from "@picoframe/frame";
import { Bookmark } from "lucide-react";
import { type ComponentProps, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { notify } from "@/notify/notify";
import type { SkirmishDraft } from "../../drafts";
import { useSkirmishPresets } from "../../presets";

/**
 * A self-contained "Save as preset" control shared by every battle surface
 * (multiplayer room, conquest overlay, warpath overlay). It opens a small popover
 * to name the preset, then saves the captured `SkirmishDraft` into the singleplayer
 * presets library (`play.presets`) so the battle can be replayed from the Skirmish
 * page later. `getDraft` is called at save time (not on render) so the snapshot
 * reflects the battle as it stands when the user commits.
 *
 * Two looks: the default labelled `button`, and a `gutter` icon box that matches
 * `BackToMapButton` for the map overlays. Either way the bookmark **fills** once
 * saved, and resets when `defaultName` changes (a different battle), so the player
 * can see this fight is already kept and needn't re-save it.
 */
export function SaveAsPresetButton({
  getDraft,
  defaultName,
  disabled,
  appearance = "button",
  variant = "outline",
  size,
  className,
  label = "Save as preset",
}: {
  /** Capture the current battle as a draft, or null if it can't be captured yet. */
  getDraft: () => SkirmishDraft | null;
  /** Pre-filled preset name (e.g. the map + opponent), editable before saving. */
  defaultName: string;
  disabled?: boolean;
  /** `gutter` = a standalone icon box (map overlays); `button` = a labelled button. */
  appearance?: "button" | "gutter";
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
  label?: string;
}) {
  const { savePreset } = useSkirmishPresets();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);

  // A different battle (new default name) is a fresh thing to save, so the filled
  // "already saved" cue resets — React's set-state-during-render pattern for
  // prop-derived state, which needs no effect.
  const prevName = useRef(defaultName);
  if (prevName.current !== defaultName) {
    prevName.current = defaultName;
    setSaved(false);
  }

  // Seed the name from the default each time the popover opens, so a re-open after
  // an edit starts fresh rather than keeping the last aborted text.
  const onOpenChange = (next: boolean) => {
    if (next) setName(defaultName);
    setOpen(next);
  };

  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setOpen(false);
    const draft = getDraft();
    if (!draft) {
      notify({
        title: "Couldn't save preset",
        body: "This battle can't be captured yet.",
        level: "error",
      });
      return;
    }
    savePreset(trimmed, draft);
    setSaved(true);
    notify({
      title: "Saved to Singleplayer presets",
      body: `"${trimmed}" — replay it from Singleplayer → Presets.`,
      level: "success",
    });
  };

  const title = saved ? "Saved as preset" : label;
  const gutter = appearance === "gutter";

  const trigger = gutter ? (
    <button
      type="button"
      disabled={disabled}
      aria-label={title}
      title={title}
      className={`pointer-events-auto flex items-center justify-center rounded-md border border-border/50 bg-card/70 p-3.5 backdrop-blur-sm transition-colors hover:border-border disabled:cursor-not-allowed disabled:opacity-50 ${
        saved ? "text-primary" : "text-muted-foreground hover:text-foreground"
      } ${className ?? ""}`}
    >
      <Bookmark
        className={saved ? "size-5 fill-current" : "size-5"}
        aria-hidden
      />
    </button>
  ) : (
    <Button
      variant={variant}
      size={size}
      disabled={disabled}
      className={className}
    >
      <Bookmark
        className={saved ? "size-4 fill-current" : "size-4"}
        aria-hidden
      />
      {title}
    </Button>
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={gutter ? "right" : "bottom"}
        align={gutter ? "start" : "end"}
        className="w-72 space-y-2"
      >
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Save as preset</p>
          <p className="text-xs text-muted-foreground">
            Saved to your Singleplayer presets to replay later.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Preset name"
            className="h-8 flex-1"
          />
          <Button size="sm" onClick={commit} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
