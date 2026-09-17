import { Button } from "@picoframe/frame";
import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AdminOnly } from "../AdminOnly";
import type { AdminReply } from "../bindings";
import { AdminRequestStatus } from "./AdminRequestStatus";
import { useAdminRequest } from "./adminRequest";

function overrideText(pinned: string | null) {
  return pinned === null ? "Looked up by the server" : `Pinned to ${pinned}`;
}

function AddressView({ reply }: { reply: AdminReply }) {
  if (reply.shape !== "showIp") return null;
  return (
    <dl className="grid grid-cols-[auto_auto_1fr] gap-x-4 gap-y-1 text-foreground">
      <dt className="text-muted-foreground">Online IP</dt>
      <dd>{reply.onlineIp}</dd>
      <dd className="text-muted-foreground">
        {overrideText(reply.onlineOverride)}
      </dd>
      <dt className="text-muted-foreground">Local IP</dt>
      <dd>{reply.localIp}</dd>
      <dd className="text-muted-foreground">
        {overrideText(reply.localOverride)}
      </dd>
    </dl>
  );
}

function RefreshView({ reply }: { reply: AdminReply }) {
  if (reply.shape !== "refreshIp") return null;
  return (
    <>
      <span>{reply.started}</span>
      {reply.result === null ? (
        <span>
          The server did not report the result in time. Show the server IP to
          check whether it changed.
        </span>
      ) : reply.failed ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>The refresh failed</AlertTitle>
          <AlertDescription>{reply.result}</AlertDescription>
        </Alert>
      ) : (
        <span className="text-foreground">{reply.result}</span>
      )}
    </>
  );
}

/**
 * ChanServ's `:refreship`, for admins only. ChanServ answers at once and
 * again when the lookup ends, and the request stays open for both.
 */
function RefreshIpAction({ serverKey }: { serverKey: string }) {
  const refresh = useAdminRequest(serverKey);
  return (
    <div className="flex flex-col gap-2 rounded border border-border p-3">
      <p className="text-xs text-muted-foreground">
        Makes the server look up its public IP address again. Battles opened
        afterwards advertise the new address. Battles already open must be
        rehosted.
      </p>
      <Button
        size="sm"
        variant="outline"
        className="h-8 self-start"
        disabled={refresh.state.status === "sending"}
        onClick={() => void refresh.send("refreship", [], "refreshIp")}
      >
        Refresh server IP
      </Button>
      <AdminRequestStatus
        state={refresh.state}
        sending="Waiting for the server to look up its address. This can take up to a minute."
      >
        {(reply) => <RefreshView reply={reply} />}
      </AdminRequestStatus>
    </div>
  );
}

/**
 * The address the server gives players for the battles they host (issue
 * #2782), through ChanServ. `:showip` is for moderators and says nothing
 * about players. `:refreship` is for admins, so it is behind `<AdminOnly>`.
 */
export function ServerAddressSection({ serverKey }: { serverKey: string }) {
  const show = useAdminRequest(serverKey);
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Server address</h2>
      <div className="flex flex-col gap-2 rounded border border-border p-3">
        <Button
          size="sm"
          variant="outline"
          className="h-8 self-start"
          onClick={() => void show.send("showip", [], "showIp")}
        >
          Show server IP
        </Button>
        <AdminRequestStatus state={show.state}>
          {(reply) => <AddressView reply={reply} />}
        </AdminRequestStatus>
      </div>
      <AdminOnly>
        <RefreshIpAction serverKey={serverKey} />
      </AdminOnly>
    </section>
  );
}
