import { Button, Input } from "@picoframe/frame";
import { Check, Download, Save, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SkirmishPreset } from "../../presets";

/**
 * Toolbar for saving/loading/deleting singleplayer presets, plus (advanced mode
 * only) an "Export start script" action. Loading a preset restores the whole
 * setup; saving snapshots the current one under a name. Naming happens through an
 * inline input rather than a modal dialog, matching the lobby-servers CRUD idiom.
 */
export function PresetBar({
  presets,
  onLoad,
  onSave,
  onDelete,
  showExport,
  onExport,
  disabled,
}: {
  presets: SkirmishPreset[];
  onLoad: (preset: SkirmishPreset) => void;
  onSave: (name: string) => SkirmishPreset;
  onDelete: (id: string) => void;
  showExport: boolean;
  onExport: () => void;
  disabled?: boolean;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  // A deleted preset leaves a dangling id; fall back to no selection so the
  // Select shows its placeholder instead of an empty value.
  const value = presets.some((p) => p.id === selectedId) ? selectedId : "";

  const load = (id: string) => {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    setSelectedId(id);
    onLoad(preset);
  };

  const commitSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const created = onSave(trimmed);
    setSelectedId(created.id);
    setName("");
    setNaming(false);
  };

  const cancelSave = () => {
    setName("");
    setNaming(false);
  };

  const remove = () => {
    if (!value) return;
    onDelete(value);
    setSelectedId("");
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.length > 0 && (
        <>
          <Select value={value} onValueChange={load} disabled={disabled}>
            <SelectTrigger size="sm" className="w-48">
              <SelectValue placeholder="Load preset…" />
            </SelectTrigger>
            <SelectContent>
              {presets.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            onClick={remove}
            disabled={disabled || !value}
            aria-label="Delete selected preset"
          >
            <Trash2 className="size-4" />
          </Button>
        </>
      )}

      {naming ? (
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitSave();
              if (e.key === "Escape") cancelSave();
            }}
            placeholder="Preset name"
            className="h-8 w-40"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={commitSave}
            disabled={!name.trim()}
            aria-label="Save preset"
          >
            <Check className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={cancelSave}
            aria-label="Cancel"
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setNaming(true)}
          disabled={disabled}
        >
          <Save className="size-4" /> Save preset
        </Button>
      )}

      {showExport && (
        <Button
          variant="outline"
          size="sm"
          onClick={onExport}
          disabled={disabled}
        >
          <Download className="size-4" /> Export start script
        </Button>
      )}
    </div>
  );
}
