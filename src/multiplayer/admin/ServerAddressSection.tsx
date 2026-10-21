import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AdminOnly } from "../AdminOnly";
import type { AdminReply } from "../bindings";
import { AdminRequestStatus } from "./AdminRequestStatus";
import { useAdminRequest } from "./adminRequest";
import { ToolGroup, ToolHeader } from "./ToolHeader";

function overrideText(pinned: string | null) {
  return pinned === null ? t`Looked up by the server` : t`Pinned to ${pinned}`;
}

function AddressView({ reply }: { reply: AdminReply }) {
  if (reply.shape !== "showIp") return null;
  return (
    <dl className="grid grid-cols-[auto_auto_1fr] gap-x-4 gap-y-1 text-foreground">
      <dt className="text-muted-foreground">
        <Trans>Online IP</Trans>
      </dt>
      <dd>{reply.onlineIp}</dd>
      <dd className="text-muted-foreground">
        {overrideText(reply.onlineOverride)}
      </dd>
      <dt className="text-muted-foreground">
        <Trans>Local IP</Trans>
      </dt>
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
          <Trans>
            The server did not report the result in time. Show the server IP to
            check whether it changed.
          </Trans>
        </span>
      ) : reply.failed ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>
            <Trans>The refresh failed</Trans>
          </AlertTitle>
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
  const { t } = useLingui();
  const refresh = useAdminRequest(serverKey);
  return (
    <ToolGroup
      title={t`Refresh the address (admins only)`}
      description={t`Makes the server look up its public IP address again. Battles opened afterwards advertise the new address. Battles already open must be rehosted.`}
    >
      <Button
        size="sm"
        variant="outline"
        className="h-8 self-start"
        disabled={refresh.state.status === "sending"}
        onClick={() => void refresh.send("refreship", [], "refreshIp")}
      >
        <Trans>Refresh server IP</Trans>
      </Button>
      <AdminRequestStatus
        state={refresh.state}
        sending={t`Waiting for the server to look up its address. This can take up to a minute.`}
      >
        {(reply) => <RefreshView reply={reply} />}
      </AdminRequestStatus>
    </ToolGroup>
  );
}

/**
 * The address the server gives players for the battles they host (issue
 * #2782), through ChanServ. `:showip` is for moderators and says nothing
 * about players. `:refreship` is for admins, so it is behind `<AdminOnly>`.
 * On the Server admin page it is the Server tool (issue #2918).
 */
export function ServerAddressSection({ serverKey }: { serverKey: string }) {
  const { t } = useLingui();
  const show = useAdminRequest(serverKey);
  return (
    <section className="flex flex-col gap-6">
      <ToolHeader
        title={t`Server address`}
        description={t`The addresses the server gives players for the battles they host.`}
        actions={
          <Button
            size="sm"
            className="h-8"
            onClick={() => void show.send("showip", [], "showIp")}
          >
            <Trans>Show server IP</Trans>
          </Button>
        }
      />
      <AdminRequestStatus state={show.state}>
        {(reply) => <AddressView reply={reply} />}
      </AdminRequestStatus>
      <AdminOnly>
        <RefreshIpAction serverKey={serverKey} />
      </AdminOnly>
    </section>
  );
}
