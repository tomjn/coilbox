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

/**
 * `read`, or a rejection with `message` once `ms` have passed without it
 * settling (issue #1916).
 *
 * A read shared by {@link shareInFlight} that never settles is worse than one
 * that fails, because every later caller for the key is handed the same stuck
 * promise, a retry included. Bounding it here means the shared read always
 * ends, is forgotten, and the next ask starts a fresh one.
 */
export function settleWithin<T>(
  read: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([read, limit]).finally(() => clearTimeout(timer));
}
