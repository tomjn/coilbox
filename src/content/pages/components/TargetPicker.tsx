import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type ScanTarget, targetKey } from "../../config";

/**
 * Picks which (content root, engine) pair the scan runs against. A root can hold
 * several engines and a user can have several roots, so this is a real choice —
 * the selection persists via the frame settings store.
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
            {t.engineVersion} · {t.rootLabel ?? t.rootPath}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
