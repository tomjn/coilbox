import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type ScanTarget, targetKey, targetLabel } from "../../config";

/**
 * Picks which engine the scan runs with. The selection persists via the frame
 * settings store.
 *
 * Engine, not content folder. Every engine belongs to exactly one folder, so
 * the list is one row per engine either way, and the folder never decided what
 * a scan found (see [`targetLabel`]).
 */
export function TargetPicker({
  targets,
  value,
  onChange,
  disabled,
}: {
  targets: ScanTarget[];
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-full sm:w-[28rem]">
        <SelectValue placeholder="Select an engine" />
      </SelectTrigger>
      <SelectContent>
        {targets.map((t) => (
          <SelectItem key={targetKey(t)} value={targetKey(t)}>
            {targetLabel(t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
