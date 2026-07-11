import { Button } from "@picoframe/frame";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { mpJoinChannel, mpListChannels } from "../bindings";
import { useMultiplayer } from "../store";

/**
 * A right-edge slide-in drawer listing the server's public channels. Requests the
 * directory each time it opens; Join sends `JOIN` and hands the name back so the
 * hub can select it once the join lands. Motion is disabled under
 * prefers-reduced-motion via the `motion-reduce:` variants.
 */
export function ChannelBrowser({
  open,
  onClose,
  onJoined,
}: {
  open: boolean;
  onClose: () => void;
  onJoined: (name: string) => void;
}) {
  const { mirror, activeKey, rememberChannel } = useMultiplayer();
  const [loading, setLoading] = useState(false);
  const directory = mirror.state?.channelDirectory ?? [];
  // The server's `ENDOFCHANNELS` bumps this counter. We record its value when a
  // request goes out and end loading once it advances past that — the honest
  // completion signal, which fires whether the directory is full or empty.
  const receivedSeq = mirror.channelListReceivedSeq;
  const requestedSeqRef = useRef(receivedSeq);

  function refresh() {
    if (!activeKey) return;
    requestedSeqRef.current = receivedSeq;
    setLoading(true);
    mpListChannels({ serverKey: activeKey }).catch(() => setLoading(false));
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: request-on-open keyed intentionally on [open, activeKey]
  useEffect(() => {
    if (!open || !activeKey) return;
    refresh();
    // Failsafe: if the server never sends ENDOFCHANNELS, resolve to the empty
    // state rather than spinning forever. The completion counter clears it first
    // in the normal case.
    const t = setTimeout(() => setLoading(false), 4000);
    return () => clearTimeout(t);
  }, [open, activeKey]);

  // Completion (channelListReceived advances the counter) ends loading, so an
  // empty directory reaches its "no channels" state at once instead of on timeout.
  useEffect(() => {
    if (receivedSeq !== requestedSeqRef.current) setLoading(false);
  }, [receivedSeq]);

  async function join(name: string) {
    if (!activeKey) return;
    try {
      await mpJoinChannel({ serverKey: activeKey, channel: name });
      rememberChannel(name);
      onJoined(name);
      onClose();
    } catch {
      // Channel-join failures are surfaced via the protocol layer, not here.
    }
  }

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close channel browser"
          className="absolute inset-0 z-10 bg-black/20"
          onClick={onClose}
        />
      )}
      <aside
        className={`absolute inset-y-0 right-0 z-20 flex w-80 flex-col border-l border-border bg-background shadow-lg transition-transform motion-reduce:transition-none ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        inert={!open}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Browse channels</h2>
          <div className="flex items-center gap-1">
            <Button variant="secondary" className="h-7 px-2" onClick={refresh}>
              Refresh
            </Button>
            <Button
              variant="secondary"
              className="h-7 px-2"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </div>
        </header>
        <ul className="flex flex-col gap-1 overflow-auto p-3">
          {loading && directory.length === 0 && (
            <li className="text-sm text-muted-foreground">Loading channels…</li>
          )}
          {!loading && directory.length === 0 && (
            <li className="text-sm text-muted-foreground">
              No channels found.
            </li>
          )}
          {directory.map((c) => (
            <li
              key={c.name}
              className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {c.name}{" "}
                  <span className="text-xs text-muted-foreground">
                    ({c.userCount})
                  </span>
                </p>
                {c.topic && (
                  <p className="truncate text-xs text-muted-foreground">
                    {c.topic}
                  </p>
                )}
              </div>
              <Button className="h-7 px-2" onClick={() => join(c.name)}>
                Join
              </Button>
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}
