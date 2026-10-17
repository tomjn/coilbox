/**
 * The category and tags of a module, as fields (issue #3298).
 *
 * Shared by the popover on a module's cell and the save step, so a module is
 * labelled the same way when it is saved and when it is edited later. The
 * state lives in the caller, which decides when to keep it.
 */

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
}

export function ModuleLabelsFields({ draft, onChange, suggestions }: Props) {
  return (
    <>
      <Field label="Category">
        <Input
          value={draft.category}
          onChange={(event) =>
            onChange({ ...draft, category: event.target.value })
          }
          placeholder="Uncategorised"
          aria-label="Module category"
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
            onClick={() => onChange({ ...draft, category: name })}
          >
            {name}
          </Button>
        ))}
      </div>
      <Field label="Tags">
        <Input
          value={draft.tags}
          onChange={(event) => onChange({ ...draft, tags: event.target.value })}
          placeholder="gun, heavy"
          aria-label="Module tags"
        />
      </Field>
    </>
  );
}
