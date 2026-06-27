import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Normalise a thrown value to a display string. */
export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Centered icon + message for "nothing here yet" / "select something" states. */
export function EmptyState({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
      <Icon size={28} className="opacity-40" />
      <p className="max-w-xs">{children}</p>
    </div>
  );
}
