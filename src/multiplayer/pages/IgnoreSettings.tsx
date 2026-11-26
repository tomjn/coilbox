import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { Plus, Trash2, UserX } from "lucide-react";
import { useState } from "react";
import { HelpPopover } from "@/components/HelpPopover";
import { SettingList, SettingRow } from "@/components/SettingRow";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { identifierFieldProps } from "@/lib/identifierField";
import { AccountPicker } from "../AccountPicker";
import { useIgnoreActions } from "../ignore";
import { liveConnectionKeys, useMultiplayer } from "../store";

/**
 * Settings section for the ignore list. Ignores are per-account, keyed by the live
 * `serverKey` (`username@host:port`), so the editor targets one connected account.
 * When disconnected it says that a connection is required. With more than one
 * connection live, a picker chooses which one (issue #2846). With one, the editor
 * targets it without asking. Ignored users' channel and private messages are
 * hidden client-side (see `useConversation`), and the change is synced to the
 * server's ignore list where supported.
 */
export default function IgnoreSettings() {
  const { t } = useLingui();
  const { connections, activeKey } = useMultiplayer();
  const liveKeys = liveConnectionKeys(connections, activeKey);
  const [manualPick, setManualPick] = useState<string | null>(null);
  const pickedKey =
    manualPick && liveKeys.includes(manualPick)
      ? manualPick
      : (liveKeys[0] ?? null);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-semibold">
          <Trans>Ignore list</Trans>
        </h2>
        <HelpPopover label={t`About ignoring`}>
          <p>
            <Trans>
              You stop seeing an ignored user's channel and private messages.
              Where the lobby server supports it, the server is told too.
            </Trans>
          </p>
          <p>
            <Trans>
              Each account has its own list. You can also ignore someone from
              their name in chat.
            </Trans>
          </p>
        </HelpPopover>
      </div>

      {!pickedKey ? (
        <p className="rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
          <Trans>Connect to a lobby server to see this account's list.</Trans>
        </p>
      ) : (
        <>
          {liveKeys.length > 1 && (
            <SettingList>
              <SettingRow label={t`Account`}>
                <AccountPicker
                  keys={liveKeys}
                  value={pickedKey}
                  onChange={setManualPick}
                />
              </SettingRow>
            </SettingList>
          )}
          {/* Keyed so a name typed for one account is not ignored on
              another picked above. */}
          <IgnoreList key={pickedKey} serverKey={pickedKey} />
        </>
      )}
    </section>
  );
}

/** One account's ignore list, with the box that adds to it as its first row. */
function IgnoreList({ serverKey }: { serverKey: string }) {
  const { t } = useLingui();
  const { list, ignore, unignore } = useIgnoreActions(serverKey);
  const [draft, setDraft] = useState("");

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    ignore(name);
    setDraft("");
  };

  return (
    <TooltipProvider>
      <ul className="divide-y divide-border rounded-md border border-border">
        <li>
          <form
            className="flex items-center gap-2 px-4 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t`username`}
              aria-label={t`Username to ignore`}
              className="min-w-0 flex-1"
              {...identifierFieldProps}
            />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={!draft.trim()}
            >
              <Plus /> <Trans>Ignore</Trans>
            </Button>
          </form>
        </li>
        {list.length === 0 ? (
          <li className="px-4 py-3 text-sm text-muted-foreground">
            <Trans>No ignored users.</Trans>
          </li>
        ) : (
          list.map((name) => (
            <li
              key={name.toLowerCase()}
              className="flex items-center gap-2 px-4 py-2 text-sm"
            >
              <UserX className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => unignore(name)}
                    aria-label={t`Stop ignoring ${name}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <Trans>Stop ignoring</Trans>
                </TooltipContent>
              </Tooltip>
            </li>
          ))
        )}
      </ul>
    </TooltipProvider>
  );
}
