import { useMemo } from "react";
import { favouritesFor, useFavourites } from "./friends";
import { type NameMark, nameMarkFor } from "./nameMark";
import { useConnection } from "./store";

/**
 * The mark for any name on one connection: the login, that server's friends
 * and local favourites, and the party. A server with no friend list and no
 * parties still marks the player's own name.
 */
export function useNameMark(
  serverKey: string | null | undefined,
): (name: string) => NameMark | null {
  const state = useConnection(serverKey)?.mirror.state ?? null;
  const [favourites] = useFavourites();
  return useMemo(() => {
    const source = {
      me: state?.myUsername ?? null,
      friends: [
        ...(state?.friends ?? []),
        ...(serverKey != null ? favouritesFor(favourites, serverKey) : []),
      ],
      party: state?.party?.members ?? [],
    };
    return (name: string) => nameMarkFor(name, source);
  }, [favourites, serverKey, state]);
}
