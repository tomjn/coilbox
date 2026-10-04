import { Button, Input } from "@picoframe/frame";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { validBattlePassword } from "@/deeplink/parse";
import { leaveAndLabel } from "./oneBattle";

/**
 * Join affordance for a battle that needs something first: a password, or the
 * player's agreement to leave a battle on another server (`notice`, issue
 * #2844). The Join button is the popover trigger, and the content is a small
 * form with the notice and, when `needsPassword`, a password field. Submitting hands the key up and closes;
 * closing resets the field. Used in place of a modal dialog (drawers/popovers
 * preferred over dialogs). Open state is controlled by the parent so the row's
 * minimap/title can open it too, not just this button.
 */
export function JoinBattlePopover({
  title,
  disabled,
  onSubmit,
  open,
  onOpenChange,
  needsPassword = true,
  notice = null,
  triggerLabel = "Join",
}: {
  title: string;
  disabled: boolean;
  /** Handed the password, or an empty string when none was asked for. */
  onSubmit: (key: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  needsPassword?: boolean;
  /** What joining leaves behind, from the one-battle rule, or null. */
  notice?: string | null;
  triggerLabel?: string;
}) {
  const [key, setKey] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setKey("");
          setRefusal(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button className="h-8 shrink-0 px-3" disabled={disabled}>
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            // The join line is split on spaces and has no escape, so a password
            // with one would reach the server as two words (issue #3410).
            if (needsPassword && key !== "" && !validBattlePassword(key)) {
              setRefusal(
                "Coilbox cannot send this password. A battle password cannot contain a space, and only letters, numbers and punctuation from the basic keyboard are allowed.",
              );
              return;
            }
            onSubmit(key);
            onOpenChange(false);
          }}
        >
          {notice && <p className="text-sm">{notice}</p>}
          {needsPassword && (
            // biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Input> control (implicit label association)
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Join {title}</span>
              <Input
                autoFocus
                type="password"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setRefusal(null);
                }}
                placeholder="Battle password"
              />
            </label>
          )}
          {refusal && (
            <p role="alert" className="text-xs text-destructive">
              {refusal}
            </p>
          )}
          <Button type="submit" className="h-8">
            {notice ? leaveAndLabel("join") : "Join"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
