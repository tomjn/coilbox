import { useCallback } from "react";
import {
  mpAcceptFriendRequest,
  mpFriendRequest,
  mpUnfriend,
} from "../bindings";
import { isFollowing, toggleFollow, useFollow } from "../follow/followStore";
import {
  addFavourite,
  isFavourite,
  removeFavourite,
  useFavourites,
} from "../friends";
import { isFriendOn } from "../friendsAcrossServers";
import { useIgnoreActions } from "../ignore";
import { useConnection } from "../store";

/** The personal entries of a player's `⋮` menu, in the shape the menu takes. */
export interface PlayerActions {
  ignore: { ignored: boolean; onToggle: () => void };
  friend?: { isFriend: boolean; onToggle: () => void };
  follow?: { following: boolean; onToggle: () => void };
}

/**
 * The ignore, friend and follow entries for any player on one connection, so
 * the member list, the direct message list and the battle room all offer the
 * same ones. Called once per list and asked per row, rather than once per row.
 *
 * Nobody befriends or follows themselves, and a room has no accounts to
 * befriend, so both entries are left out there. Follow is for friends alone
 * (issue #3696).
 */
export function usePlayerActions(
  serverKey: string | null,
): (name: string) => PlayerActions {
  const connection = useConnection(serverKey);
  const state = connection?.mirror.state ?? null;
  const direct = connection?.direct ?? false;
  const [favourites, setFavourites] = useFavourites();
  const follow = useFollow();
  const { has: ignoredNow, toggle: toggleIgnore } = useIgnoreActions(serverKey);

  return useCallback(
    (name: string) => {
      const actions: PlayerActions = {
        ignore: {
          ignored: ignoredNow(name),
          onToggle: () => toggleIgnore(name),
        },
      };
      if (!serverKey || direct || name === state?.myUsername) return actions;

      const starred = isFavourite(favourites, serverKey, name);
      const serverFriend = (state?.friends ?? []).includes(name);
      const isFriend = isFriendOn(favourites, serverKey, state, name);
      actions.friend = {
        isFriend,
        // A friend is starred here and, where the server keeps friends, asked
        // there too. Somebody who has already asked us is accepted instead.
        // The server half no-ops where there is no support for it.
        onToggle: () => {
          if (isFriend) {
            // Only a friend can be followed, so the follow ends with it.
            if (isFollowing(follow, serverKey, name)) {
              toggleFollow(serverKey, name);
            }
            if (starred) {
              setFavourites(removeFavourite(favourites, serverKey, name));
            }
            if (serverFriend) {
              mpUnfriend({ serverKey, username: name }).catch(() => {});
            }
            return;
          }
          setFavourites(addFavourite(favourites, serverKey, name));
          const answer = (state?.friendRequests ?? []).includes(name)
            ? mpAcceptFriendRequest
            : mpFriendRequest;
          answer({ serverKey, username: name }).catch(() => {});
        },
      };
      if (isFriend) {
        actions.follow = {
          following: isFollowing(follow, serverKey, name),
          onToggle: () => toggleFollow(serverKey, name),
        };
      }
      return actions;
    },
    [
      serverKey,
      direct,
      state,
      favourites,
      setFavourites,
      follow,
      ignoredNow,
      toggleIgnore,
    ],
  );
}
