/**
 * The mount points a chassis piece carries (issue #3279): connectors marked as
 * places a module goes, each with a name, the module categories that fit it and
 * what sits there now.
 */

import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { Trash2 } from "lucide-react";

import { OptionSelect } from "@/components/OptionSelect";
import type { LegoMountPoint, LegoPiece, LegoProject } from "../../model";
import { mountContents, parseCategories } from "../../mountPoints";

interface Props {
  piece: LegoPiece;
  project: LegoProject;
  /** Every connector of the piece, with the name to show for it. */
  connectors: { id: string; label: string }[];
  onMark: (connector: string) => void;
  onChange: (
    connector: string,
    change: Partial<Pick<LegoMountPoint, "name" | "accepts">>,
  ) => void;
  onRemove: (connector: string) => void;
}

export function MountPointList({
  piece,
  project,
  connectors,
  onMark,
  onChange,
  onRemove,
}: Props) {
  const marked = new Set((piece.mountPoints ?? []).map((m) => m.connector));
  const unmarked = connectors.filter((c) => !marked.has(c.id));
  const labelOf = (id: string) =>
    connectors.find((c) => c.id === id)?.label ?? id;

  return (
    <div className="mt-2">
      <span className="text-xs text-muted-foreground">
        <Trans>Mount points</Trans>
      </span>
      {unmarked.length > 0 ? (
        <OptionSelect
          value=""
          onValueChange={onMark}
          options={unmarked.map((c) => ({ value: c.id, label: c.label }))}
          placeholder={t`Mark a connector`}
          size="sm"
          className="mt-1 w-full"
          ariaLabel={t`Mark a connector as a mount point`}
        />
      ) : null}

      {mountContents(project, piece).map(({ mount, onIt }) => {
        const mountName = mount.name;
        const connectorLabel = labelOf(mount.connector);
        return (
          <div
            key={mount.connector}
            className="mt-2 rounded-md border border-border px-2 py-1.5"
          >
            <div className="flex items-center gap-1">
              <Input
                value={mount.name}
                onChange={(event) =>
                  onChange(mount.connector, { name: event.target.value })
                }
                aria-label={t`Mount point name`}
                className="h-7 flex-1 text-xs"
              />
              <Button
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
                onClick={() => onRemove(mount.connector)}
                aria-label={t`Unmark ${mountName}`}
                title={t`Unmark this mount point`}
              >
                <Trash2 size={12} />
              </Button>
            </div>
            <Input
              key={mount.accepts.join(",")}
              defaultValue={mount.accepts.join(", ")}
              onBlur={(event) =>
                onChange(mount.connector, {
                  accepts: parseCategories(event.target.value),
                })
              }
              placeholder={t`Categories, comma separated`}
              aria-label={t`Categories ${mountName} takes`}
              className="mt-1 h-7 text-xs"
            />
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {onIt === null ? (
                <Trans>{connectorLabel}: empty</Trans>
              ) : (
                <Trans>
                  {connectorLabel}: {onIt}
                </Trans>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}
