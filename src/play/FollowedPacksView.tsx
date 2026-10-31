import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { RefreshCw } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { FollowedPack, useFollowedPacks } from "./followedPacks";

/**
 * The sheet's face for preset packs followed by their address (issue #1298): add
 * one, refresh them, see when each last updated and unfollow one. Their presets
 * are on the sheet's list, beside the player's own.
 */
export function FollowedPacksView({
  followed,
  disabled,
}: {
  followed: ReturnType<typeof useFollowedPacks>;
  disabled?: boolean;
}) {
  const { t, i18n } = useLingui();
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const follow = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const refused = await followed.follow(address);
    setBusy(false);
    setError(refused);
    if (!refused) setAddress("");
  };

  const refresh = async () => {
    setBusy(true);
    await followed.refreshAll();
    setBusy(false);
  };

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
      <form onSubmit={follow} className="flex items-center gap-2">
        <Input
          aria-label={t`Pack address`}
          placeholder="https://raw.githubusercontent.com/..."
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          disabled={disabled || busy}
        />
        <Button
          type="submit"
          className="shrink-0"
          disabled={disabled || busy || !address.trim()}
        >
          <Trans>Follow</Trans>
        </Button>
      </form>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {followed.packs.length > 0 && (
        <>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={disabled || busy}
            onClick={refresh}
          >
            <RefreshCw className="size-4" /> <Trans>Refresh</Trans>
          </Button>
          <ul className="flex flex-col gap-2">
            {followed.packs.map((pack) => {
              const updatedAt = i18n.date(new Date(pack.lastUpdatedAt), {
                dateStyle: "medium",
                timeStyle: "short",
              });
              return (
                <li
                  key={pack.id}
                  className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3"
                >
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {pack.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {pack.url}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t`Last updated ${updatedAt}`}
                    </span>
                    {pack.lastError && (
                      <span className="mt-0.5 block text-xs text-destructive">
                        {pack.lastError}
                      </span>
                    )}
                  </div>
                  <UnfollowButton
                    pack={pack}
                    disabled={disabled}
                    onUnfollow={followed.unfollow}
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** Unfollowing forgets the pack's address, so it asks first. */
function UnfollowButton({
  pack,
  disabled,
  onUnfollow,
}: {
  pack: FollowedPack;
  disabled?: boolean;
  onUnfollow: (packId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const title = pack.title;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={disabled}
        >
          <Trans>Unfollow</Trans>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            <Trans>
              Unfollow "{title}"? Its presets go. Copies you saved stay.
            </Trans>
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              <Trans>Keep following</Trans>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setOpen(false);
                onUnfollow(pack.id);
              }}
            >
              <Trans>Unfollow</Trans>
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
