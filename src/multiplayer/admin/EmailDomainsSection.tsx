import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { useEffect, useState } from "react";
import { SlideDrawer } from "@/components/SlideDrawer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { identifierFieldProps } from "@/lib/identifierField";
import type { BlacklistEntry } from "../bindings";
import { AdminRequestStatus } from "./AdminRequestStatus";
import { useAdminRequest } from "./adminRequest";
import { DrawerBody, ToolHeader } from "./ToolHeader";

function DomainsTable({
  entries,
  onUnblock,
}: {
  entries: BlacklistEntry[];
  onUnblock: (domain: string) => void;
}) {
  const { t } = useLingui();
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>No domains are blocked.</Trans>
      </p>
    );
  }
  return (
    <Table className="text-foreground">
      <TableHeader>
        <TableRow>
          <TableHead>
            <Trans>Domain</Trans>
          </TableHead>
          <TableHead>
            <Trans>Reason</Trans>
          </TableHead>
          <TableHead>
            <Trans>Issuer</Trans>
          </TableHead>
          <TableHead>
            <span className="sr-only">
              <Trans>Actions</Trans>
            </span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.domain}>
            <TableCell>{entry.domain}</TableCell>
            <TableCell className="whitespace-normal">{entry.reason}</TableCell>
            <TableCell>{entry.issuer}</TableCell>
            <TableCell className="text-right">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7"
                aria-label={t`Unblock ${entry.domain}…`}
                onClick={() => onUnblock(entry.domain)}
              >
                <Trans>Unblock…</Trans>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * `BLACKLIST <domain> [reason]`: blocks a domain from being used to register
 * a new account. The reason is optional, so it is only sent when typed.
 */
function BlockDomainForm({
  serverKey,
  onChanged,
}: {
  serverKey: string;
  onChanged: () => void;
}) {
  const { t } = useLingui();
  const [domain, setDomain] = useState("");
  const [reason, setReason] = useState("");
  const block = useAdminRequest(serverKey);

  const canSubmit = domain.trim() !== "";

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">
        <Trans>Block a domain</Trans>
      </legend>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          const args =
            reason.trim() === ""
              ? [domain.trim()]
              : [domain.trim(), reason.trim()];
          void block
            .send("BLACKLIST", args, "blacklistDomain")
            .then((state) => {
              if (state.status === "answered") onChanged();
            });
        }}
      >
        <span className="flex flex-col gap-1 text-xs text-muted-foreground">
          <Trans>Domain</Trans>
          <Input
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            aria-label={t`Domain`}
            className="h-8"
            {...identifierFieldProps}
          />
        </span>
        <span className="flex flex-col gap-1 text-xs text-muted-foreground">
          <Trans>Reason (optional)</Trans>
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-label={t`Reason`}
            className="h-8"
          />
        </span>
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          className="h-8 self-start"
          disabled={!canSubmit}
        >
          <Trans>Block domain</Trans>
        </Button>
      </form>
      <AdminRequestStatus state={block.state}>
        {(reply) => (reply.shape === "blacklistDomain" ? reply.message : null)}
      </AdminRequestStatus>
    </fieldset>
  );
}

/**
 * `UNBLACKLIST <domain>`: lifts a block. The domain is pre-filled from the
 * row whose Unblock action opened the form, but stays editable.
 */
function UnblockDomainForm({
  serverKey,
  initialDomain,
  onChanged,
}: {
  serverKey: string;
  initialDomain: string;
  onChanged: () => void;
}) {
  const { t } = useLingui();
  const [domain, setDomain] = useState(initialDomain);
  const unblock = useAdminRequest(serverKey);

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">
        <Trans>Unblock a domain</Trans>
      </legend>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (domain.trim() === "") return;
          void unblock
            .send("UNBLACKLIST", [domain.trim()], "unblacklistDomain")
            .then((state) => {
              if (state.status === "answered") onChanged();
            });
        }}
      >
        <span className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          <Trans>Domain</Trans>
          <Input
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            aria-label={t`Domain to unblock`}
            className="h-8"
            {...identifierFieldProps}
          />
        </span>
        <Button
          type="submit"
          size="sm"
          className="h-8"
          disabled={domain.trim() === ""}
        >
          <Trans>Unblock domain</Trans>
        </Button>
      </form>
      <AdminRequestStatus state={unblock.state}>
        {(reply) =>
          reply.shape === "unblacklistDomain" ? reply.message : null
        }
      </AdminRequestStatus>
    </fieldset>
  );
}

/** Which form the drawer holds, if any. */
type DomainsDrawer = { kind: "block" } | { kind: "unblock"; domain: string };

const DRAWER_TITLES: Record<DomainsDrawer["kind"], MessageDescriptor> = {
  block: msg`Block a domain`,
  unblock: msg`Unblock a domain`,
};

/**
 * The Email domains tool of the Server admin page (issues #2784 and #2918):
 * `LISTBLACKLIST` as the tool's main content, with `BLACKLIST` as its primary
 * action and `UNBLACKLIST` as a secondary one. Each form opens on demand in a
 * drawer, and the table refreshes after every change. Each row has its own
 * Unblock action, which opens `UNBLACKLIST` filled with that row's domain.
 */
export function EmailDomainsSection({ serverKey }: { serverKey: string }) {
  const { t, i18n } = useLingui();
  const [drawer, setDrawer] = useState<DomainsDrawer | null>(null);
  const list = useAdminRequest(serverKey);

  // Only the connection changing should trigger a fresh load here, not
  // `list.send` itself. `refresh` below re-sends explicitly after every
  // block or unblock.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the connection changes, not on every list.send identity change
  useEffect(() => {
    void list.send("LISTBLACKLIST", [], "blacklist");
  }, [serverKey]);

  const refresh = () => {
    void list.send("LISTBLACKLIST", [], "blacklist");
  };

  return (
    <section className="flex flex-col gap-4">
      <ToolHeader
        title={t`Email domains`}
        description={t`Blocks a domain from being used to register a new account.`}
        actions={
          <Button
            type="button"
            size="sm"
            className="h-8"
            onClick={() => setDrawer({ kind: "block" })}
          >
            <Trans>Block a domain…</Trans>
          </Button>
        }
      />
      <AdminRequestStatus state={list.state}>
        {(reply) =>
          reply.shape === "blacklist" ? (
            <DomainsTable
              entries={reply.entries}
              onUnblock={(domain) => setDrawer({ kind: "unblock", domain })}
            />
          ) : null
        }
      </AdminRequestStatus>
      <SlideDrawer
        open={drawer !== null}
        title={drawer ? i18n._(DRAWER_TITLES[drawer.kind]) : ""}
        onClose={() => setDrawer(null)}
      >
        <DrawerBody>
          {drawer?.kind === "block" && (
            <BlockDomainForm serverKey={serverKey} onChanged={refresh} />
          )}
          {drawer?.kind === "unblock" && (
            <UnblockDomainForm
              serverKey={serverKey}
              initialDomain={drawer.domain}
              onChanged={refresh}
            />
          )}
        </DrawerBody>
      </SlideDrawer>
    </section>
  );
}
