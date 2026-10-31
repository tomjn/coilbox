import { afterEach, describe, expect, it } from "vitest";
import {
  forgetOaPassword,
  holdOaHostPassword,
  holdOaJoinPassword,
  type OaPasswordView,
  oaPasswordFor,
  observeOaPassword,
} from "./oaPassword";

const SERVER = "me@server:8200";
const OA = { engine: "Open Annihilation", key: "s3cret" };

const view = (over: Partial<OaPasswordView> = {}): OaPasswordView => ({
  connected: true,
  ready: true,
  battleId: 7,
  joinError: null,
  ...over,
});
const observe = (v: OaPasswordView | null) => observeOaPassword(() => v);

afterEach(forgetOaPassword);

describe("holding the password of an OA battle being opened", () => {
  it("holds it for the battle the lobby then shows", () => {
    holdOaHostPassword(SERVER, null, OA);
    observe(view());
    expect(oaPasswordFor(SERVER, 7)).toBe("s3cret");
    expect(oaPasswordFor(SERVER, 8)).toBeNull();
    expect(oaPasswordFor("other", 7)).toBeNull();
  });

  it("answers the room that arrives before the provider has looked", () => {
    holdOaHostPassword(SERVER, null, OA);
    expect(oaPasswordFor(SERVER, 7)).toBe("s3cret");
  });

  it("does not take the battle the host was already in for the new one", () => {
    holdOaHostPassword(SERVER, 5, OA);
    expect(oaPasswordFor(SERVER, 5)).toBeNull();
    observe(view({ battleId: 5 }));
    observe(view({ battleId: 6 }));
    expect(oaPasswordFor(SERVER, 6)).toBe("s3cret");
  });

  it("holds nothing for an open battle or a Recoil one", () => {
    holdOaHostPassword(SERVER, null, { ...OA, key: "*" });
    expect(oaPasswordFor(SERVER, 7)).toBeNull();
    holdOaHostPassword(SERVER, null, { ...OA, engine: "spring" });
    expect(oaPasswordFor(SERVER, 7)).toBeNull();
  });
});

describe("holding the key a player joins with", () => {
  const battle = { id: 7, engine: "Open Annihilation" };

  it("holds it for that battle only", () => {
    holdOaJoinPassword(SERVER, battle, "s3cret");
    expect(oaPasswordFor(SERVER, 7)).toBe("s3cret");
    expect(oaPasswordFor(SERVER, 8)).toBeNull();
  });

  it("holds nothing with no key, or for a Recoil battle", () => {
    holdOaJoinPassword(SERVER, battle, undefined);
    expect(oaPasswordFor(SERVER, 7)).toBeNull();
    holdOaJoinPassword(SERVER, { id: 7, engine: "spring" }, "s3cret");
    expect(oaPasswordFor(SERVER, 7)).toBeNull();
  });

  it("drops the last battle's password when joining another", () => {
    holdOaJoinPassword(SERVER, battle, "s3cret");
    holdOaJoinPassword(SERVER, { ...battle, id: 8 }, undefined);
    expect(oaPasswordFor(SERVER, 7)).toBeNull();
  });
});

describe("forgetting when the battle goes", () => {
  const battle = { id: 7, engine: "Open Annihilation" };
  const landed = () => {
    holdOaJoinPassword(SERVER, battle, "s3cret");
    observe(view());
  };

  it("keeps it while the player is in the battle", () => {
    landed();
    observe(view());
    expect(oaPasswordFor(SERVER, 7)).toBe("s3cret");
  });

  it("waits for the join to land", () => {
    holdOaJoinPassword(SERVER, battle, "s3cret");
    observe(view({ battleId: null }));
    expect(oaPasswordFor(SERVER, 7)).toBe("s3cret");
  });

  it("forgets when the player left, was kicked or the battle closed", () => {
    landed();
    observe(view({ battleId: null }));
    expect(oaPasswordFor(SERVER, 7)).toBeNull();
  });

  it("forgets when the lobby refused the attempt", () => {
    holdOaJoinPassword(SERVER, battle, "wrong");
    observe(view({ battleId: null, joinError: "wrong password" }));
    expect(oaPasswordFor(SERVER, 7)).toBeNull();
  });

  it("forgets an attempt the connection dropped under", () => {
    holdOaJoinPassword(SERVER, battle, "s3cret");
    observe(view({ connected: false, battleId: null }));
    expect(oaPasswordFor(SERVER, 7)).toBeNull();
  });

  it("forgets when the connection is gone", () => {
    landed();
    observe(null);
    expect(oaPasswordFor(SERVER, 7)).toBeNull();
  });

  it("keeps it through a drop until login has finished", () => {
    landed();
    observe(view({ connected: false, ready: false, battleId: null }));
    observe(view({ ready: false, battleId: null }));
    expect(oaPasswordFor(SERVER, 7)).toBe("s3cret");
    observe(view());
    expect(oaPasswordFor(SERVER, 7)).toBe("s3cret");
  });

  it("forgets a reconnect that finishes login out of the battle", () => {
    landed();
    observe(view({ connected: false, ready: false, battleId: null }));
    observe(view({ battleId: null }));
    expect(oaPasswordFor(SERVER, 7)).toBeNull();
  });
});
