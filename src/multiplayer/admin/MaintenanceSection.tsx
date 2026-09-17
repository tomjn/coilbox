import { Button, Input } from "@picoframe/frame";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AdminRequestStatus } from "./AdminRequestStatus";
import { useAdminRequest } from "./adminRequest";
import { ToolGroup, ToolHeader } from "./ToolHeader";

/**
 * `SETMINSPRINGVERSION <version>` (issue #2785): the minimum Spring engine
 * version for battles hosted by bot-flagged accounts. Confirmed in a
 * popover, because it also closes every open bot-hosted battle on an older
 * engine at once, after posting a notice in each one's chat.
 */
function SetMinSpringVersionAction({ serverKey }: { serverKey: string }) {
  const [version, setVersion] = useState("");
  const request = useAdminRequest(serverKey);
  const canSubmit = version.trim() !== "";

  return (
    <ToolGroup
      title="Minimum engine version"
      description="The oldest Spring engine version a bot-flagged account may host a battle on."
    >
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-8 self-start"
          >
            Set minimum engine version…
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-80 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">
              Set the minimum engine version?
            </h3>
            <p className="text-xs text-muted-foreground">
              Every open battle a bot-flagged account hosts on an older engine
              closes immediately, after uberserver posts a notice in its chat.
            </p>
          </div>
          <span className="flex flex-col gap-1 text-xs text-muted-foreground">
            Version
            <Input
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              aria-label="Minimum engine version"
              className="h-8"
            />
          </span>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-8"
              disabled={!canSubmit || request.state.status === "sending"}
              onClick={() =>
                void request.send(
                  "SETMINSPRINGVERSION",
                  [version.trim()],
                  "setMinSpringVersion",
                )
              }
            >
              Set version
            </Button>
          </div>
          <AdminRequestStatus
            state={request.state}
            unanswered="The server did not answer."
          >
            {(reply) =>
              reply.shape === "setMinSpringVersion" ? (
                <span>Set to {reply.version}.</span>
              ) : null
            }
          </AdminRequestStatus>
        </PopoverContent>
      </Popover>
    </ToolGroup>
  );
}

/**
 * `STATS` (issue #2785): writes command counts, login counts and agent
 * stats to the server's own log file. Nothing about them reaches coilbox,
 * so that is said beside the button rather than left to be discovered after
 * clicking it.
 */
function StatsAction({ serverKey }: { serverKey: string }) {
  const request = useAdminRequest(serverKey);
  return (
    <ToolGroup
      title="Server statistics"
      description="Writes the server's command counts, login counts and agent stats to its own log file. Nothing is shown here."
    >
      <Button
        type="button"
        size="sm"
        className="h-8 self-start"
        disabled={request.state.status === "sending"}
        onClick={() => void request.send("STATS", [], "stats")}
      >
        Write stats to the server log
      </Button>
      <AdminRequestStatus
        state={request.state}
        unanswered="The server did not answer."
      />
    </ToolGroup>
  );
}

/**
 * `RELOAD` (issue #2785): reloads the server's non-core code without
 * restarting it. Confirmed in a popover. uberserver announces the attempt
 * in `#moderator` immediately and the result there as well, but both travel
 * as a channel message rather than the direct reply this waits for.
 */
function ReloadAction({ serverKey }: { serverKey: string }) {
  const request = useAdminRequest(serverKey);
  return (
    <ToolGroup
      title="Reload"
      description="Reloads the server's code without restarting it. Announces the attempt in #moderator, then the result there and here."
    >
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-8 self-start"
          >
            Reload…
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-80 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">Reload the server's code?</h3>
            <p className="text-xs text-muted-foreground">
              Posts a notice in #moderator, reloads, then posts and replies with
              whether it worked.
            </p>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-8"
              disabled={request.state.status === "sending"}
              onClick={() => void request.send("RELOAD", [], "reload")}
            >
              Reload
            </Button>
          </div>
          <AdminRequestStatus
            state={request.state}
            unanswered="The server did not answer."
          >
            {(reply) =>
              reply.shape === "reload" ? (
                reply.success ? (
                  <span>{reply.message}</span>
                ) : (
                  <Alert variant="destructive">
                    <TriangleAlert />
                    <AlertTitle>The reload failed</AlertTitle>
                    <AlertDescription>{reply.message}</AlertDescription>
                  </Alert>
                )
              ) : null
            }
          </AdminRequestStatus>
        </PopoverContent>
      </Popover>
    </ToolGroup>
  );
}

/**
 * `CLEANUP` (issue #2785): clears out inconsistent server state. Confirmed
 * in a popover, with the same `#moderator` timing as `RELOAD`. uberserver
 * only replies on success: an exception inside cleanup leaves the admin
 * with silence rather than a refusal, so the unanswered wording says so.
 */
function CleanupAction({ serverKey }: { serverKey: string }) {
  const request = useAdminRequest(serverKey);
  return (
    <ToolGroup
      title="Cleanup"
      description="Clears out inconsistent server state left over from a crash or a bug. Announces the attempt in #moderator, then the result there and here."
    >
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-8 self-start"
          >
            Cleanup…
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-80 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">Clean up server state?</h3>
            <p className="text-xs text-muted-foreground">
              Posts a notice in #moderator, then deletes anything it finds
              inconsistent and posts and replies with what it removed.
            </p>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-8"
              disabled={request.state.status === "sending"}
              onClick={() => void request.send("CLEANUP", [], "cleanup")}
            >
              Clean up
            </Button>
          </div>
          <AdminRequestStatus
            state={request.state}
            unanswered="The server did not answer. A cleanup that raised an error on the server sends no reply at all."
          >
            {(reply) =>
              reply.shape === "cleanup" ? <span>{reply.message}</span> : null
            }
          </AdminRequestStatus>
        </PopoverContent>
      </Popover>
    </ToolGroup>
  );
}

/**
 * The Maintenance tool of the Server admin page (issue #2785): uberserver's
 * four server-wide admin commands, `SETMINSPRINGVERSION`, `STATS`, `RELOAD`
 * and `CLEANUP`. uberserver has no server console, so this is how an admin
 * runs these jobs without shell access to the server machine. The whole
 * tool is admin-only (`adminOnly: true` in `ADMIN_TOOLS`), the first one in
 * the registry, so none of its actions needs its own `<AdminOnly>` guard.
 */
export function MaintenanceSection({ serverKey }: { serverKey: string }) {
  return (
    <section className="flex flex-col gap-6">
      <ToolHeader
        title="Maintenance"
        description="uberserver's own maintenance jobs, for admins only."
      />
      <SetMinSpringVersionAction serverKey={serverKey} />
      <StatsAction serverKey={serverKey} />
      <ReloadAction serverKey={serverKey} />
      <CleanupAction serverKey={serverKey} />
    </section>
  );
}
