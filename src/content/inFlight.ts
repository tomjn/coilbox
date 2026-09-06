/**
 * One read for however many callers ask for the same key while it is open.
 *
 * Every unitsync read here spawns a worker process and mounts an archive, and a
 * page that mounts two hooks for one map, or eight for one game's units, was
 * spawning that many. `pending` is the caller's own map of open reads, kept
 * beside its session cache, and `start` is the read itself, run only when
 * nothing is already open for `key`. A read that settled, either way, is
 * forgotten, so a retry after a failure runs it again.
 */
export function shareInFlight<T>(
  pending: Map<string, Promise<T>>,
  key: string,
  start: () => Promise<T>,
): Promise<T> {
  const open = pending.get(key);
  if (open) return open;
  const read = start().finally(() => pending.delete(key));
  pending.set(key, read);
  return read;
}
