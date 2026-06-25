import { Button, cn, Input } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, X } from "lucide-react";
import type { ReactNode } from "react";
import { AssetPreview } from "./AssetPreview";
import { Field } from "./Field";

/**
 * A path field: a read-only text input showing the selected path plus a Browse
 * button that opens the native OS picker (`@tauri-apps/plugin-dialog`). We use
 * native pickers because a web view cannot enumerate the filesystem itself; the
 * surrounding option panels are hosted in side drawers instead of modal dialogs.
 *
 * Pass `directory` to pick a folder, or `filters` to constrain file types.
 */
export function PathField({
  label,
  hint,
  help,
  learnMore,
  value,
  onChange,
  disabled,
  directory = false,
  filters,
  defaultPath,
  className,
  preview = false,
  onInfo,
}: {
  label: string;
  hint?: string;
  help?: ReactNode;
  learnMore?: string;
  value: string;
  onChange: (path: string) => void;
  disabled?: boolean;
  directory?: boolean;
  filters?: { name: string; extensions: string[] }[];
  defaultPath?: string;
  className?: string;
  /** Show a thumbnail + dimensions of the selected image. */
  preview?: boolean;
  onInfo?: (info: { width: number; height: number }) => void;
}) {
  async function browse() {
    const picked = await open({
      title: `Select ${label}`,
      directory,
      multiple: false,
      filters: directory ? undefined : filters,
      defaultPath: defaultPath || value || undefined,
    });
    // `open` returns null on cancel, a string for a single selection.
    if (typeof picked === "string") onChange(picked);
  }

  return (
    <Field
      label={label}
      hint={hint}
      help={help}
      learnMore={learnMore}
      className={className}
    >
      <div className="flex gap-2">
        <Input
          value={value}
          readOnly
          placeholder="(none)"
          className="font-mono text-xs"
          disabled={disabled}
        />
        {value && !disabled && (
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange("")}
            aria-label={`Clear ${label}`}
            className={cn("shrink-0")}
          >
            <X />
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={browse}
          disabled={disabled}
          aria-label={`Browse for ${label}`}
          className={cn("shrink-0")}
        >
          <FolderOpen /> Browse
        </Button>
      </div>
      {preview && value && <AssetPreview path={value} onInfo={onInfo} />}
    </Field>
  );
}
