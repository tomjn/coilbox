import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { ChevronRight, Rss } from "lucide-react";

/** The way into followed preset packs from the preset sheet. */
export function FollowedPacksRow({
  packCount,
  disabled,
  onOpen,
}: {
  packCount: number;
  disabled?: boolean;
  onOpen: () => void;
}) {
  const { t } = useLingui();
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className="mb-3 flex w-full min-w-0 items-center gap-3 rounded-lg border border-border/50 bg-card p-3 text-left transition-colors hover:border-border hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Rss className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {t`Followed packs`}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {packCount > 0
            ? plural(packCount, {
                one: "Following # pack",
                other: "Following # packs",
              })
            : t`Follow a preset pack by its address`}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
