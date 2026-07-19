import { Button, Input } from "@picoframe/frame";
import { Bookmark } from "lucide-react";
import { type ComponentProps, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { notify } from "@/notify/notify";
import type { SkirmishDraft } from "../../drafts";
import { presetMatchesDraft, useSkirmishPresets } from "../../presets";

/**
 * A self-contained "Save as preset" control shared by every battle surface
 * (multiplayer room, conquest overlay, warpath overlay). It opens a small popover
 * to name the preset, then saves the captured `SkirmishDraft` into the singleplayer
 * presets library (`play.presets`) so the battle can be replayed from the Skirmish
 * page later. `getDraft` is called on render (to decide the "already saved" cue) and
 * again at save time so the committed snapshot reflects the battle as it then stands.
 *
 * Two looks: the default labelled `button`, and a `gutter` icon box that matches
 * `BackToMapButton` for the map overlays. Either way the bookmark **fills** when a
 * saved preset already captures this exact battle (matched on the draft content, not
 * the name the user gave it), so the player can see this fight is already kept and
 * needn't re-save it. The cue is derived from the saved presets, not local state, so
 * it survives leaving and re-entering the battle overlay.
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
  const { presets, savePreset } = useSkirmishPresets();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  // "Already saved" is derived from the presets library, not local state, so the
  // filled cue reflects reality across mounts (leaving and re-entering the overlay)
  // and different fights: it's true when a saved preset captures this exact battle,
  // whatever name it was given. `getDraft` returns null when the battle can't be
  // captured yet (e.g. game not installed), in which case nothing is saved.
  const draft = getDraft();
  const saved = draft ? presetMatchesDraft(presets, draft) : false;

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
