import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { errorText } from "@/lib/helpers";

/**
 * Normalise a thrown value to a display string. Re-exported under its
 * original name (see `@/lib/errorText`, issue #2434) so its 15+ existing
 * importers are unaffected.
 */
export const errMessage = errorText;

/** Centered icon + message for "nothing here yet" / "select something" states.
 * `action`, if given, sits below the message - optional so the four existing
 * callers with no button to offer are unaffected. */
export function EmptyState({
  icon: Icon,
  action,
  children,
}: {
  icon: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
      <Icon size={28} className="opacity-40" />
      <p className="max-w-xs">{children}</p>
      {action}
    </div>
  );
}
