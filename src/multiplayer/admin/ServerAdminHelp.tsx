import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

/**
 * A short help panel for the Server admin page (issue #2783): what
 * uberserver cleans up on its own schedule, and what no lobby client can do
 * at all, however much access you hold. Both lists are checked against
 * uberserver's source directly (`DataHandler.py`'s `scheduled_clean`,
 * `SQLUsers.py`'s `clean` and `audit_access`, and `SETACCESS` in
 * `protocol/Protocol.py`). See `docs/server-admin.md` for the full page.
 *
 * Sits above the tool list and its content, rather than inside any one tool,
 * since both lists apply to the page as a whole. Collapsed by default, the
 * same disclosure `WindowsFirewall` uses for "What does this change?", so it
 * reads as something to open rather than a wall of text ahead of the tools.
 */
export function ServerAdminHelp() {
  return (
    <Collapsible className="border-b border-border px-4 py-2">
      <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight
          aria-hidden
          className="size-3 motion-safe:transition-transform group-data-[state=open]:rotate-90"
        />
        What uberserver cleans up by itself, and what no client can do
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 grid gap-4 pl-4 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <h3 className="font-medium text-foreground">
            What the server cleans up by itself
          </h3>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            <li>
              Accounts still at the <code>agreement</code> level are deleted 3
              days after registering.
            </li>
            <li>
              Accounts with no in-game time are deleted after 28 days without a
              login. Bots, moderators and admins are exempt.
            </li>
            <li>
              Every account is deleted after 1825 days (5 years) without a
              login, with no exemptions.
            </li>
            <li>
              Bot flags, and moderator or admin levels, are removed after 365
              days without a login.
            </li>
            <li>Stored channel history older than 14 days is deleted.</li>
            <li>
              Sessions logged in for more than 14 days are logged out. Bots and
              static accounts are exempt.
            </li>
          </ul>
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="font-medium text-foreground">What no client can do</h3>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            <li>
              Create the first admin, or set an account to the{" "}
              <code>fresh</code> or <code>agreement</code> levels.{" "}
              <code>SETACCESS</code> only accepts <code>user</code>,{" "}
              <code>mod</code> and <code>admin</code>.
            </li>
            <li>Change a ban's reason or length. Lift it and ban again.</li>
            <li>
              Show staff actions from before you connected, unless a moderator
              already turned on <code>#moderator</code> history. It isn't on by
              default.
            </li>
          </ul>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
