import { useCallback, useMemo, useState } from "react";
import {
  type EnqueueInput,
  identityOf,
  type QueueItem,
  useDownloadQueue,
} from "@/downloads/DownloadQueueProvider";

/**
 * The downloads the player starts from a wizard page, so the pill and the Done
 * page show them beside the background ones. Each is followed by its queue
 * identity rather than its queue id, so it is still found after a retry from
 * anywhere in the app queues it again under a new id.
 */
export function usePickedDownloads(): {
  items: QueueItem[];
  track(input: EnqueueInput): void;
  /** Queues a tracked download again. False when `id` is not one of these. */
  retry(id: string): boolean;
} {
  const queue = useDownloadQueue();
  const [picked, setPicked] = useState<EnqueueInput[]>([]);

  const track = useCallback((input: EnqueueInput) => {
    const identity = identityOf(input);
    setPicked((list) =>
      list.some((i) => identityOf(i) === identity) ? list : [...list, input],
    );
  }, []);

  const items = useMemo(() => {
    const found: QueueItem[] = [];
    for (const input of picked) {
      const identity = identityOf(input);
      const item =
        queue.items.find((i) => i.identity === identity) ??
        queue.settled?.find((i) => i.identity === identity);
      if (item) found.push(item);
    }
    return found;
  }, [picked, queue.items, queue.settled]);

  const { enqueue } = queue;
  const retry = useCallback(
    (id: string) => {
      const item = items.find((i) => i.id === id);
      const input = picked.find((i) => identityOf(i) === item?.identity);
      if (!input) return false;
      enqueue(input);
      return true;
    },
    [items, picked, enqueue],
  );

  return { items, track, retry };
}
