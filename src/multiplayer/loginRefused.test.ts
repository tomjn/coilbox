import { describe, expect, it } from "vitest";
import { isLoginRefusedCode, isPasswordRefusal } from "./loginRefused";

/**
 * The reasons below are the real strings servers send, so a reworded one shows
 * up here. Sources:
 *
 * - uberserver `protocol/Protocol.py` (`login_now`, `_validUsernameSyntax`,
 *   `_validLegacyPasswordSyntax`, `_login_checked`) and `SQLUsers.py`
 *   (`check_login_user`, `check_banned`).
 * - Teiserver `lib/teiserver/data/cache_user.ex` (`try_md5_login`) and
 *   `spring_in.ex` (the `LOGIN` handler).
 * - Zero-K's `LoginResponse.Code` descriptions, as `refusal` in `zerok_conn.rs`
 *   writes them.
 */
const NAMES_A_PASSWORD: [string, string][] = [
  ["uberserver wrong password or unknown name", "Invalid username or password"],
  ["uberserver empty password", "Empty password."],
  ["uberserver empty legacy password", "Empty passwords are not allowed."],
  ["Teiserver wrong password", "Invalid password"],
  ["Zero-K wrong password", "invalid password"],
];

const DOES_NOT: [string, string][] = [
  ["uberserver second login", "Already logged in."],
  ["uberserver blank name", "Username is blank."],
  [
    "uberserver name characters",
    "Only ASCII chars, [], _, 0-9 are allowed in usernames.",
  ],
  [
    "uberserver short name",
    "Username is too short, must be at least 3 characters.",
  ],
  ["uberserver long name", "Username is too long, max 20 characters."],
  ["uberserver bad base64", "Invalid base64-encoding."],
  [
    "uberserver bad base64 with detail",
    "Invalid base64-encoding: Incorrect padding",
  ],
  ["uberserver bad checksum", "Invalid MD5-checksum."],
  ["uberserver wrong case", "Invalid username -- did you mean 'Tom'"],
  ["uberserver nasty name", "Invalid username: 'x'"],
  ["uberserver nasty sentence", "Invalid sentence args"],
  [
    "uberserver old client",
    "Invalid sentence format, please update your lobby client.",
  ],
  [
    "uberserver database error",
    "Login failed due to a server error, please try again.",
  ],
  [
    "uberserver delayed registration",
    "Your registration was detected as a non-residential IP address and will be delayed for 24 hours. Time remaining: 3 hours",
  ],
  ["uberserver ban", "You are banned: (spamming), 3 days remaining"],
  [
    "uberserver ban whose reason says password",
    "You are banned: (sharing a password), less than one hour remaining",
  ],
  ["Teiserver unknown name", "No user found for 'Tom'"],
  ["Teiserver wrong case", "Username is case sensitive, try 'Tom'"],
  [
    "Teiserver flood",
    "Flood protection - Please wait 20 seconds and try again",
  ],
  ["Teiserver missing hash", "LobbyHash/UserID missing in login"],
  ["Teiserver banned", "Banned account"],
  [
    "Teiserver banned, as sent",
    "Banned, please see the discord channel #moderation-bot for more details",
  ],
  [
    "Teiserver full",
    "The server is currently full, please try again in a minute or two.",
  ],
  ["Teiserver bad format", "Invalid details format"],
  ["Zero-K invalid name", "invalid name"],
  ["Zero-K banned", "banned"],
  ["Zero-K banned with its reason", "banned: password sharing"],
  ["Zero-K too many attempts", "banned, too many connection attempts"],
  ["Zero-K full", "sorry, the server is full, please retry later"],
  ["Zero-K unknown code", "the server refused the login (code 42)"],
  ["no reason at all", ""],
];

describe("isPasswordRefusal", () => {
  it.each(NAMES_A_PASSWORD)("%s: %s", (_label, reason) => {
    expect(isPasswordRefusal(reason)).toBe(true);
  });

  it.each(DOES_NOT)("%s: %s", (_label, reason) => {
    expect(isPasswordRefusal(reason)).toBe(false);
  });

  it("treats a missing reason as not a password", () => {
    expect(isPasswordRefusal(null)).toBe(false);
    expect(isPasswordRefusal(undefined)).toBe(false);
  });

  it("falls to not a password for a reason nobody has seen", () => {
    expect(isPasswordRefusal("Zugriff verweigert")).toBe(false);
  });
});

describe("isLoginRefusedCode", () => {
  const coded = (code: string) =>
    new Error(JSON.stringify({ code, params: {}, fallback: "x" }));

  it("reads the code, not the words", () => {
    expect(isLoginRefusedCode(coded("multiplayer.login.refused"))).toBe(true);
    expect(isLoginRefusedCode(coded("multiplayer.login.timeout"))).toBe(false);
    expect(isLoginRefusedCode(coded("multiplayer.login.ended"))).toBe(false);
  });

  it("does not take the English message for the code", () => {
    expect(isLoginRefusedCode(new Error("the server refused the login"))).toBe(
      false,
    );
  });

  it("is false for anything that is not an error", () => {
    expect(isLoginRefusedCode("multiplayer.login.refused")).toBe(false);
    expect(isLoginRefusedCode(null)).toBe(false);
  });
});
