/**
 * The comparison view (issue #1316): the fields where two or more selected
 * units differ, one column per unit, rather than the two pages the issue
 * says the game usually costs somebody. `differingColumns` (`unitReference.ts`)
 * decides which rows to show. A field the selection agrees on says nothing a
 * comparison needs to, so it is left out rather than padding the table.
 */
import { Button, Drawer } from "@picoframe/frame";
import { X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  differingColumns,
  formatReferenceValue,
  type UnitReferenceRow,
} from "../../unitReference";

export function UnitCompareDrawer({
  open,
  onOpenChange,
  rows,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selected units, in selection order. */
  rows: UnitReferenceRow[];
  onRemove: (key: string) => void;
}) {
  const columns = differingColumns(rows);
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Compare units"
      description={
        rows.length < 2
          ? "Select at least two units to compare."
          : columns.length === 0
            ? "Every field below is the same across the selected units."
            : "Only the fields where the selected units differ."
      }
      width="48rem"
    >
      {rows.length >= 2 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              {rows.map((row) => (
                <TableHead key={row.key}>
                  <div className="flex items-center gap-1">
                    <span className="truncate">{row.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-5 shrink-0"
                      onClick={() => onRemove(row.key)}
                      aria-label={`Remove ${row.name} from the comparison`}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </Button>
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {columns.map((column) => (
              <TableRow key={column.id}>
                <TableCell className="font-medium text-muted-foreground">
                  {column.label}
                </TableCell>
                {rows.map((row) => (
                  <TableCell key={row.key} className="tabular-nums">
                    {formatReferenceValue(column.value(row))}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Drawer>
  );
}
