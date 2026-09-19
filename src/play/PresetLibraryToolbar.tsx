import { Button, Input } from "@picoframe/frame";
import { Check, Save, Upload, X } from "lucide-react";
import { useState } from "react";
import { CoilboxGlyph } from "@/components/CoilboxGlyph";
import type { SkirmishDraft } from "./drafts";
import { NewPresetFromReplayButton } from "./pages/components/NewPresetFromReplayButton";

/**
 * The four ways a preset gets into the library, above whichever list is showing.
 *
 * Shared by the Singleplayer sheet and the battle room's, because the library
 * is one library. The room used to offer none of this, with saving sitting as a
 * separate button out in the sidebar, so the same drawer did different things
 * depending on which screen you opened it from.
 *
 * Only `onSave` differs by surface: Singleplayer saves the setup on the page,
 * a room saves the battle as it currently stands. Naming is inline rather than
 * a popover so the row itself becomes the field, which is what the sheet has
 * always done.
 */
export function PresetLibraryToolbar({
  saveLabel,
  onSave,
  onImport,
  onSaveFromReplay,
  onBrowseHub,
  disabled,
}: {
  /** What the save button says, e.g. "Save current setup". */
  saveLabel: string;
  onSave: (name: string) => void;
  onImport: () => void;
  onSaveFromReplay: (name: string, draft: SkirmishDraft) => void;
  /** Open the hub, narrowed to presets. */
  onBrowseHub: () => void;
  disabled?: boolean;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName("");
    setNaming(false);
  };
  const cancel = () => {
    setName("");
    setNaming(false);
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border/60 px-5 py-3">
        {naming ? (
          <>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") cancel();
              }}
              placeholder="Preset name"
              className="h-8 flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={commit}
              disabled={!name.trim()}
              aria-label="Save preset"
            >
              <Check className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={cancel}
              aria-label="Cancel"
            >
              <X className="size-4" />
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNaming(true)}
              disabled={disabled}
              className="flex-1"
            >
              <Save className="size-4" /> {saveLabel}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onImport}
              disabled={disabled}
            >
              <Upload className="size-4" /> Import
            </Button>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-b border-border/60 px-5 py-3">
        {/* Seed a preset from a decoded replay's setup, the other end of the
         * refight pipeline from the replay detail page's "Refight this setup". */}
        <NewPresetFromReplayButton
          onSave={onSaveFromReplay}
          disabled={disabled}
        />
        {/* Where presets come from when you have not made one. Lands on the hub
         * already narrowed to presets rather than on everything shared. */}
        <Button
          variant="outline"
          size="sm"
          onClick={onBrowseHub}
          disabled={disabled}
        >
          <CoilboxGlyph size={16} /> Browse the hub
        </Button>
      </div>
    </>
  );
}
