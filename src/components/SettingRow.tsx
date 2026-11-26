import type { ReactNode } from "react";
import { HelpPopover } from "@/components/HelpPopover";
import { Label } from "@/components/ui/label";

/**
 * One setting in a settings list: its name, an optional one-line description,
 * an optional help button, and the control on the right. Rows go in a
 * `<SettingList>` so they share one border and divider, as the Engines page's
 * lists do.
 *
 * `id` is the control's id. The name is a `<label>` for it, so clicking the
 * name flips a switch or opens a select. The description, when there is one,
 * gets `${id}-description` for the control's `aria-describedby`. Leave `id`
 * out for a button, so clicking the name does not press it.
 */
export function SettingRow({
  id,
  label,
  description,
  help,
  helpLabel,
  children,
}: {
  id?: string;
  label: string;
  description?: string;
  /** What the help popover says. Needs `helpLabel` to name its button. */
  help?: ReactNode;
  helpLabel?: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          {id ? (
            <Label htmlFor={id} className="cursor-pointer text-sm font-medium">
              {label}
            </Label>
          ) : (
            <span className="text-sm font-medium">{label}</span>
          )}
          {help && helpLabel && (
            <HelpPopover label={helpLabel}>{help}</HelpPopover>
          )}
        </div>
        {description && (
          <p
            id={id && `${id}-description`}
            className="mt-0.5 text-xs text-muted-foreground"
          >
            {description}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </li>
  );
}

/** The bordered, divided list that holds `<SettingRow>`s. */
export function SettingList({ children }: { children: ReactNode }) {
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {children}
    </ul>
  );
}
