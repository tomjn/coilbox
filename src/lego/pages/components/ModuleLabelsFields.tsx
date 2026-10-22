/**
 * The category and tags of a module, as fields (issue #3298).
 *
 * Shared by the detail panel and the save step, so a module is labelled the
 * same way when it is saved and when it is edited later. The state lives in the
 * caller, which decides when to keep it.
 */

import { t } from "@lingui/core/macro";
import { Button, Input } from "@picoframe/frame";

import { Field } from "@/components/Field";

export interface ModuleLabelsDraft {
  category: string;
  /** Comma separated, as typed. */
  tags: string;
}

interface Props {
  draft: ModuleLabelsDraft;
  onChange: (draft: ModuleLabelsDraft) => void;
  /** Categories to pick from, with any typed text still allowed. */
  suggestions: string[];
  /**
   * For fields that save as they go, with no Save button: called when a field
   * loses focus, on Enter, and with the new draft when a suggestion is picked.
   */
  onCommit?: (draft: ModuleLabelsDraft) => void;
}

export function ModuleLabelsFields({
  draft,
  onChange,
  suggestions,
  onCommit,
}: Props) {
  const commitProps = onCommit
    ? {
        onBlur: () => onCommit(draft),
        onKeyDown: (event: React.KeyboardEvent) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          onCommit(draft);
        },
      }
    : {};
  return (
    <>
      <Field label={t`Category`}>
        <Input
          value={draft.category}
          onChange={(event) =>
            onChange({ ...draft, category: event.target.value })
          }
          placeholder={t`Uncategorised`}
          aria-label={t`Module category`}
          {...commitProps}
        />
      </Field>
      <div className="flex flex-wrap gap-1">
        {suggestions.map((name) => (
          <Button
            key={name}
            size="sm"
            variant={
              name.toLowerCase() === draft.category.trim().toLowerCase()
                ? "default"
                : "outline"
            }
            onClick={() => {
              const next = { ...draft, category: name };
              onChange(next);
              onCommit?.(next);
            }}
          >
            {name}
          </Button>
        ))}
      </div>
      <Field label={t`Tags`}>
        <Input
          value={draft.tags}
          onChange={(event) => onChange({ ...draft, tags: event.target.value })}
          placeholder={t`gun, heavy`}
          aria-label={t`Module tags`}
          {...commitProps}
        />
      </Field>
    </>
  );
}
