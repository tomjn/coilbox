import { Button, Input } from "@picoframe/frame";
import { Pencil } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { chanServTopic } from "../moderation";

/**
 * Channel-header control (channel operators only) to set the topic via ChanServ.
 * An inline popover form rather than a modal, matching the project's drawer/popover
 * preference. `send` is wired by the caller to `mpSend`.
 */
export function ChannelTopicMenu({
  channel,
  currentTopic,
  send,
}: {
  /** Bare channel name (no `#`). */
  channel: string;
  currentTopic?: string;
  send: (line: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        // Seed the field with the current topic each time it opens.
        if (v) setTopic(currentTopic ?? "");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          className="h-7 px-2"
          aria-label="Set channel topic"
        >
          <Pencil className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(chanServTopic(channel, topic.trim()));
            setOpen(false);
          }}
        >
          <span className="flex flex-col gap-1 text-xs text-muted-foreground">
            Channel topic
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Topic text"
              aria-label="Channel topic"
              autoFocus
            />
          </span>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" className="h-8">
              Set topic
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
