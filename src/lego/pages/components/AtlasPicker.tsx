/**
 * Which atlas a unit samples.
 *
 * A per-unit choice and never a per-piece one: an s3o names a single texture
 * and every piece in the model uses it, so two pieces in one unit could not
 * sample different atlases even if the builder let you ask for it.
 *
 * Switching is safe at any point in a build. An atlas pack redraws the sheet the
 * parts are already mapped into and brings no parts of its own, so every part
 * stays available in every atlas: nothing is dropped, nothing is remapped, and
 * the pieces are untouched. The change is an ordinary edit, so undo takes it
 * back.
 *
 * Hidden when there is one atlas installed and the unit uses it, because a
 * control with one option is noise. A unit naming an atlas that is not installed
 * still gets the control, since moving it onto one that is installed is the only
 * way to put it right without going and finding the pack.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { unitAtlas } from "../../atlas";
import type { LegoProject } from "../../model";
import type { LoadedPack } from "../../pack";

interface Props {
  project: LegoProject;
  pack: LoadedPack;
  /** Undefined for the base pack's atlas, which is stored as no atlas at all. */
  onChange: (atlas: string | undefined) => void;
}

export function AtlasPicker({ project, pack, onChange }: Props) {
  const atlases = pack.library.atlases;
  const unit = unitAtlas(project, atlases);
  if (atlases.length < 2 && unit.installed) return null;

  // Its own row rather than sharing the line above: at a narrow window the
  // piece count, the export name and this together are wider than the card.
  return (
    <div className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
      <span>atlas</span>
      <Select
        value={unit.texture}
        onValueChange={(value) =>
          onChange(value === atlases[0].tex1 ? undefined : value)
        }
      >
        <SelectTrigger
          size="sm"
          className="h-5 w-40 border-transparent bg-transparent px-1 text-xs hover:border-border focus-visible:border-border"
          aria-label="Atlas"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {unit.installed ? null : (
            // Selectable so the trigger has something to show, and the label
            // says why the unit is not drawn in it.
            <SelectItem value={unit.texture}>
              {unit.texture} (not installed)
            </SelectItem>
          )}
          {atlases.map((atlas) => (
            <SelectItem key={atlas.tex1} value={atlas.tex1}>
              {atlas.packId}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
