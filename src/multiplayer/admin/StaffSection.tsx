import { Button, Input } from "@picoframe/frame";
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { identifierFieldProps } from "@/lib/identifierField";
import type { AdminReply } from "../bindings";
import { usernameFromKey } from "../store";
import { AdminRequestStatus } from "./AdminRequestStatus";
import { useAdminRequest } from "./adminRequest";
import { ToolGroup, ToolHeader } from "./ToolHeader";

const ACCESS_OPTIONS = [
  { value: "user", label: "User" },
  { value: "mod", label: "Mod" },
  { value: "admin", label: "Admin" },
];

function StaffGroup({ title, names }: { title: string; names: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{title}</h3>
      {names.length === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
      ) : (
        <ul className="flex flex-col gap-0.5 text-sm text-foreground">
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** `LISTMODS`'s `Admins: ...` and `Mods: ...` lines, plus the 365-day expiry
 * rule beside them (issue #2786). */
function StaffList({
  reply,
}: {
  reply: Extract<AdminReply, { shape: "listMods" }>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        The server removes moderator and admin access from an account after 365
        days without a login.
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        <StaffGroup title="Admins" names={reply.admins} />
        <StaffGroup title="Mods" names={reply.mods} />
      </div>
    </div>
  );
}

/**
 * `SETACCESS <username> user|mod|admin` (issue #2786), shared between the
 * Staff tool's own form and the Players tool's lookup, where it is wrapped in
 * `<AdminOnly>` since `SETACCESS` is admin-only while the rest of the lookup
 * is not.
 *
 * The confirm step's wording depends on what is chosen: setting mod or admin
 * also takes the account off every player's ignore list, uberserver's own
 * side effect of `in_SETACCESS`, said before it happens rather than
 * discovered after. An admin who targets their own account and picks
 * anything but admin is warned separately: uberserver has no undo for that
 * beyond another admin or a direct database change.
 *
 * `SETACCESS`'s success is a bare `OK` with no data of its own
 * (`AdminShape.setAccess` in `bindings.ts`), so `onChanged` is only called
 * once the reply says `success`, rather than for any answer the way a form
 * with a message-carrying reply can afford to.
 */
export function SetAccessAction({
  username,
  serverKey,
  onChanged,
  disabled = false,
}: {
  username: string;
  serverKey: string;
  onChanged: () => void;
  disabled?: boolean;
}) {
  const [level, setLevel] = useState<"user" | "mod" | "admin">("user");
  const request = useAdminRequest(serverKey);
  const isSelf =
    username.trim().toLowerCase() === usernameFromKey(serverKey).toLowerCase();
  const selfDemote = isSelf && level !== "admin";
  const canSubmit = !disabled && username.trim() !== "";

  const confirm = () => {
    if (!canSubmit) return;
    void request
      .send("SETACCESS", [username.trim(), level], "setAccess")
      .then((state) => {
        if (
          state.status === "answered" &&
          state.reply.shape === "setAccess" &&
          state.reply.success
        ) {
          onChanged();
        }
      });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          disabled={!canSubmit}
        >
          Change access…
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <h3 className="text-sm font-medium">Change {username}'s access?</h3>
        <OptionSelect
          value={level}
          onValueChange={(value) => setLevel(value as "user" | "mod" | "admin")}
          options={ACCESS_OPTIONS}
          ariaLabel="New access level"
          size="sm"
        />
        {level !== "user" && (
          <p className="text-xs text-muted-foreground">
            Setting {username} to {level} also takes them off every player's
            ignore list.
          </p>
        )}
        {selfDemote && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>This is your own account</AlertTitle>
            <AlertDescription>
              Only another admin, or a direct change to the database, can give
              it back.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            className="h-8"
            onClick={confirm}
            disabled={!canSubmit || request.state.status === "sending"}
          >
            Change access
          </Button>
        </div>
        <AdminRequestStatus
          state={request.state}
          unanswered="The server did not answer."
        >
          {(reply) =>
            reply.shape === "setAccess" ? (
              reply.success ? (
                <span>Done.</span>
              ) : (
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertTitle>The server refused</AlertTitle>
                  <AlertDescription>{reply.message}</AlertDescription>
                </Alert>
              )
            ) : null
          }
        </AdminRequestStatus>
      </PopoverContent>
    </Popover>
  );
}

/** The Staff tool's own form: change any account's access by name, rather
 * than only one already shown by a lookup. */
function ChangeAccessForm({
  serverKey,
  onChanged,
}: {
  serverKey: string;
  onChanged: () => void;
}) {
  const [username, setUsername] = useState("");

  return (
    <ToolGroup
      title="Change an account's access"
      description="Set an account to user, mod or admin."
    >
      <span className="flex max-w-xs flex-col gap-1 text-xs text-muted-foreground">
        Username
        <Input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          aria-label="Username"
          className="h-8"
          {...identifierFieldProps}
        />
      </span>
      <SetAccessAction
        username={username.trim()}
        serverKey={serverKey}
        onChanged={onChanged}
        disabled={username.trim() === ""}
      />
    </ToolGroup>
  );
}

/**
 * The Staff tool of the Server admin page (issue #2786): `LISTMODS` as the
 * list of everyone with moderator or admin access, and `SETACCESS` as the
 * form to move an account between `user`, `mod` and `admin`. Admin-only
 * (`adminOnly: true` in `ADMIN_TOOLS`), since both commands are in
 * uberserver's `restricted['admin']` set.
 */
export function StaffSection({ serverKey }: { serverKey: string }) {
  const list = useAdminRequest(serverKey);

  // Only the connection changing should trigger a fresh load here, not
  // `list.send` itself. `refresh` below re-sends explicitly after every
  // access change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the connection changes, not on every list.send identity change
  useEffect(() => {
    void list.send("LISTMODS", [], "listMods");
  }, [serverKey]);

  const refresh = () => {
    void list.send("LISTMODS", [], "listMods");
  };

  return (
    <section className="flex flex-col gap-6">
      <ToolHeader
        title="Staff"
        description="Everyone with moderator or admin access on this server."
      />
      <AdminRequestStatus
        state={list.state}
        unanswered="The server did not answer."
      >
        {(reply) =>
          reply.shape === "listMods" ? <StaffList reply={reply} /> : null
        }
      </AdminRequestStatus>
      <ChangeAccessForm serverKey={serverKey} onChanged={refresh} />
    </section>
  );
}
