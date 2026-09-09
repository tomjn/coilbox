# Lobby account management design

Date: 2026-09-09

Password recovery for a user who is locked out, and account management for a user who is signed in, against the TASServer line protocol.

## The problem

Coilbox can create a lobby account and log in to one. It cannot do anything else with one. A user who forgets their password has no route back in, and a user who wants to change a password, change an email address or re-request a verification code has to find another client. The recovery case is the worse of the two, because a user who has forgotten their password often does not know their username either, and coilbox stores neither in a form they can read.

## What the servers actually do

Verified by reading the two server implementations rather than the protocol documentation, which is marked `[GAP]` for this whole area (`~/dev/uberserver/PROTOCOL.md:736`).

| Command | uberserver | Teiserver (BAR) |
|---|---|---|
| `RESETPASSWORDREQUEST <email>` | Pre-auth. Emails an 8 digit code, replies `RESETPASSWORDREQUESTACCEPTED <email>` | Pre-auth, ignores the argument, replies `OK cmd=https://<host>/password_reset` |
| `RESETPASSWORD <email> <code>` | Pre-auth. Generates a random 10 character password, emails it, replies `RESETPASSWORDACCEPTED <email> <username>`, then disconnects | Not implemented |
| `CHANGEPASSWORD <old> <new>` | Signed in. Both arguments hashed. Replies with a bare `SERVERMSG`, no accept or deny token | Handler exists, marked `# Unused`, returns an error |
| `CHANGEEMAILREQUEST <email>` | Signed in. Emails a code, replies `CHANGEEMAILREQUESTACCEPTED` or `...DENIED <reason>` | Same |
| `CHANGEEMAIL <email> <code>` | Signed in. Replies `CHANGEEMAILACCEPTED <email>` or `CHANGEEMAILDENIED <reason>` | Same |
| `RESENDVERIFICATION <email>` | Replies `RESENDVERIFICATIONACCEPTED` or `...DENIED <reason>` | Not implemented |
| `GETUSERINFO` | Three `SERVERMSG` lines, no reply token | Three `SERVERMSG` lines with the same three labels |

Sources: `~/dev/uberserver/protocol/Protocol.py:3137,3303,3994,4052,4071,4218`, `~/dev/uberserver/PROTOCOL.md:186`, `~/dev/teiserver/lib/teiserver/protocols/spring/spring_in.ex:56,433,440,475,500`, `~/dev/teiserver/lib/teiserver/protocols/spring/spring_out.ex:128`.

Three facts drive the whole design:

1. The same command name means different things on the two servers. `RESETPASSWORDREQUEST` starts a code exchange on uberserver and hands back a web address on Teiserver. One flow with two outcomes, not two flows.
2. On uberserver the server picks the new password and emails it in plaintext, then disconnects. A client cannot offer "choose your own new password". The flow has to end differently.
3. `RESETPASSWORDACCEPTED` echoes the account's username back. That is the answer to "I do not know my login", and it arrives at the end of the flow rather than the start.

`RESENDVERIFICATION` is listed as available to everyone in uberserver's restricted map, but the handler reads `client.user_id`, which an unauthenticated connection does not have. It is treated here as a signed-in command.

## Scope

In scope: password recovery, change password, change email, resend verification, account info.

Out of scope: Zero-K and Tachyon account management. Zero-K's protocol has no change-password, reset-password or change-email message, upstream or in `crates/coilbox-zerok-protocol`. Tachyon has no password at all, because it signs in through the browser. Controls are shown only where `serverProtocol(server) === "tasserver"`. Neither server gets a link to its own website, because that would mean putting addresses in the catalog that we cannot verify from the code.

## Existing work this builds on

Nothing in the repo mentions any of these commands. The wire work is new. The patterns are not.

- `LoginMode::Register` in `crates/coilbox-lobby-protocol/src/login.rs:37-46` already shares the greeting, STLS and `LISTCOMPFLAGS` prelude with login and differs only in the command sent on `COMPFLAGS`. Recovery is a third mode of the same kind.
- `CONFIRMAGREEMENT` is already a full "server emails a code, the machine parks, the user types it back, the machine resumes" cycle: `LoginPhase::AwaitAgreement`, `LoginMachine::submit_agreement_code` at `login.rs:248`, `mp_confirm_agreement` at `crates/tauri-plugin-coilbox-multiplayer/src/lib.rs:759`, and `src/multiplayer/VerificationCodeDialog.tsx`. `RESETPASSWORD` and `CHANGEEMAIL` are the same cycle with a different verb.
- `register()` in `src/multiplayer/store.tsx:1653-1731` opens a throwaway connection, resolves or rejects on the event channel, and always tears the connection down in a `finally`. Recovery copies that lifecycle.
- `ServerMessage::Ok { text }` already exists at `crates/coilbox-lobby-protocol/src/message.rs:306` and is discarded by `reduce.rs:1015`.
- Coilbox holds exactly one lobby connection, enforced by `src/multiplayer/oneLobbyConnection.dom.test.tsx` for issue #2149. "The signed-in account" is therefore unambiguous.

## Wire layer

`crates/coilbox-lobby-protocol/src/command.rs` gains seven builders, each guarded by the existing `is_wire_safe` and `fits_one_field` checks:

```
reset_password_request(email)        -> RESETPASSWORDREQUEST <email>
reset_password(email, code)          -> RESETPASSWORD <email> <code>
change_password(old_hash, new_hash)  -> CHANGEPASSWORD <old_hash> <new_hash>
change_email_request(email)          -> CHANGEEMAILREQUEST <email>
change_email(email, code)            -> CHANGEEMAIL <email> <code>
resend_verification(email)           -> RESENDVERIFICATION <email>
get_user_info()                      -> GETUSERINFO
```

Both `CHANGEPASSWORD` arguments are `hash::password_hash()` output. `SQLUsers.py:684` writes the second argument straight into the column that `check_login_user` at `SQLUsers.py:610` compares a login against, so a raw password there would set one the user could never use.

`message.rs` gains ten `ServerMessage` variants and their `parse_line` arms:

```
ResetPasswordRequestAccepted { email }
ResetPasswordRequestDenied   { reason }
ResetPasswordAccepted        { email, username }
ResetPasswordDenied          { reason }
ChangeEmailRequestAccepted
ChangeEmailRequestDenied     { reason }
ChangeEmailAccepted          { email }
ChangeEmailDenied            { reason }
ResendVerificationAccepted
ResendVerificationDenied     { reason }
```

`ServerMessage::Ok` stops being discarded, but only inside one phase. See below.

## Recovery as a third login mode

`LoginMode::Recover { email }` joins `Login` and `Register` in `login.rs`. On `COMPFLAGS` it sends `RESETPASSWORDREQUEST` in place of `LOGIN`. The prelude is untouched.

Four new `LoginPhase` values:

| Phase | Entered on | Leaves by |
|---|---|---|
| `AwaitRecoveryRequest` | `RESETPASSWORDREQUEST` sent | one of the three below, or `Denied` |
| `AwaitRecoveryCode` | `RESETPASSWORDREQUESTACCEPTED` | `submit_recovery_code(code)` sends `RESETPASSWORD` |
| `Recovered` | `RESETPASSWORDACCEPTED`, terminal | the server disconnects us |
| `RecoveryRedirected` | `Ok { text }` while in `AwaitRecoveryRequest`, terminal | client disconnects |

`RESETPASSWORDDENIED` returns to `AwaitRecoveryCode` rather than `Denied`, because uberserver allows three attempts before locking the entry and the user should get the other two.

`Ok` is read as a recovery address only in `AwaitRecoveryRequest`. Everywhere else it keeps its current meaning, which is to be ignored. This is the only change to existing message handling.

`submit_recovery_code` mirrors `submit_agreement_code`: a no-op unless parked in the matching phase, returning the lines to send.

`LoginConfig` requires `username` and `password_hash`, and recovery has neither. `mp_recover_password` passes empty strings and the field docs say why. Making both fields `Option` would touch every login and register call site for no behaviour change, so it is not done here.

## Connection layer

`crates/tauri-plugin-coilbox-multiplayer` gains seven `#[tauri::command]` entry points:

```
mp_recover_password       opens its own connection, LoginMode::Recover
mp_submit_recovery_code   drives submit_recovery_code on that connection
mp_change_password        Outbound::Line on the live connection
mp_change_email_request   Outbound::Line on the live connection
mp_change_email           Outbound::Line on the live connection
mp_resend_verification    Outbound::Line on the live connection
mp_get_user_info          Outbound::Line on the live connection
```

Recovery uses a short-lived connection of its own, as registration does. `open_and_spawn` refuses a duplicate registry key, and recovery has no username, so it keys on `serverKeyFor(server, email)`.

The five signed-in commands need no new `Outbound` variants. `Outbound::Line(command::x(..))` is the route `join_battle`, `open_battle` and `turn_credentials` already take (`conn.rs:1325,1331`, `turn.rs:342`), and `lib.rs:177` already holds the send-to-a-connection helper. Wire building stays in the protocol crate either way. A `Line` sent on a Tachyon connection is dropped by `tachyon_conn.rs:595` rather than mangled, which backs up the capability check in the interface.

Every one of the seven needs three things, and missing any one of them fails at runtime rather than at build time:

1. the name in the `COMMANDS` list in `build.rs`
2. an `allow-mp-*` line in `permissions/default.toml`
3. a generated file under `permissions/autogenerated/commands/`

## Deltas and the store

New `Delta` variants, mirrored into the `Delta` union in `src/multiplayer/bindings.ts`:

```
recoveryCodeSent          { email }
recoveryUrl               { url }
recoveryDenied            { reason }
passwordReset             { email, username }
changeEmailCodeSent
changeEmailAccepted       { email }
changeEmailDenied         { reason }
resendVerificationAccepted
resendVerificationDenied  { reason }
accountInfo               { registrationDate?, email?, ingameHours? }
changePasswordResult      { message, succeeded }
```

`accountInfo` is assembled in `reduce.rs` by matching `SERVERMSG` text against three labels, because `GETUSERINFO` has no reply token on either server. Both send the same three: `Registration date: `, `Email address: `, `Ingame time: `. A matching line produces an `accountInfo` delta in addition to its current console delta, so nothing visible today disappears.

`changePasswordResult` is the same trick for `CHANGEPASSWORD`, which also has no token. `succeeded` is true only on an exact match of uberserver's `Password changed successfully.`

`store.tsx` gains `recoverPassword`, `submitRecoveryCode`, `changePassword`, `changeEmailRequest`, `changeEmail`, `resendVerification` and `getUserInfo` on `useMultiplayer()`. The two recovery calls follow `register()`: resolve or reject on the event channel, tear the connection down in a `finally` whatever the outcome.

## Interface: recovery

`PasswordRecoveryForm` in `src/lobby-servers/`, sibling to `RegisterForm.tsx`, sharing its shape and its server dropdown filtered to `serverProtocol(s) === "tasserver"`.

Reached from the two places `RegisterForm` is already reached from, both of which import it today:

- a "Forgot password?" link under the password field in the connect popover in `src/multiplayer/LobbyStatusButton.tsx`
- a button beside Register in `src/lobby-servers/pages/SettingsSection.tsx`

The user picks a server and enters an email address. Three end states:

**Code sent.** A code field and a submit button. A wrong code shows the server's reason verbatim and leaves the field open. The copy states that three wrong attempts lock the request, so the user does not spend them without knowing.

**Redirected.** "Reset your password on the server's website", the address shown as readable text, and an Open button calling `openUrl` from `@tauri-apps/plugin-opener`, matching `src/lib/MarkdownLink.tsx:84`. The connection is closed straight away, because nothing further can happen on it.

**Reset.** The username the server echoed, first and largest on the panel, because it answers the question the user could not answer themselves. Below it, a note that a new password is now in their email, a Sign in button that prefills the server and username in the connect popover, and a line pointing at the account page to replace the emailed password with one of their own.

## Interface: the account page

A new settings section at `/settings/account`, `parent: "multiplayer"`, registered from a new `src/account/index.ts` built in the same shape as `src/lobby-servers/index.ts:13-29`. Its subject is the one live connection.

Three states:

- **Signed in to a TASServer server.** Account info fetched with `GETUSERINFO` on mount, change password, change email with its code step, resend verification.
- **Signed in to Zero-K or Tachyon.** One line saying account management for that server happens on the server's own site. No controls.
- **Not signed in.** The account that would be managed, and a Connect button. Not a blank page.

## Change password, and the fact we cannot be sure

`CHANGEPASSWORD` succeeds with a bare `SERVERMSG` reading `Password changed successfully.` and fails with a bare `SERVERMSG` carrying a reason. There is no token, so there is no reliable signal. The handling is fixed in one place and is the same every time:

- The server's message is shown verbatim, whatever it says.
- `lsStoreCredential` is called only on an exact match of the success string.
- On any other reply the keychain is left untouched and the panel says the saved password may now be out of date, with the account editor one click away. A stale stored password is recoverable by retyping it. A wrongly overwritten one is not.
- Teiserver returns a no-match error here, because its handler is a stub. That message is displayed as it arrives. The control is not hidden on Teiserver because there is no way to tell Teiserver from uberserver without sending something and seeing what comes back.

The rejected alternative was to prove the change by opening a throwaway connection and logging in with the new password. It is more reliable and roughly doubles the code for a case that is rare on the servers we know about. If the string match turns out to fail on a real server, this is the fallback to reach for.

## Testing

Rust, in `crates/coilbox-lobby-protocol`:

- a unit test per new command builder, including the wire-safety guards rejecting an email with a space in it
- a unit test per new `parse_line` arm
- `LoginMachine` tests walking `Recover` to each of its three outcomes, including Teiserver's `OK cmd=<url>` and the three-attempt code path
- a test that `Ok` outside `AwaitRecoveryRequest` is still ignored
- reducer tests for `accountInfo` label matching, for `changePasswordResult` on both the success string and a failure string, and for a `SERVERMSG` that must not be captured by either

TypeScript, with vitest:

- the recovery form in each of its three end states
- the account page in each of its three states
- both driving the real provider rather than a copy of its logic, following the reasoning in `src/multiplayer/oneLobbyConnection.dom.test.tsx:1-18`

End to end: `uberstress` bench mode launches a real uberserver from a checkout against MySQL and resets the database each run (`crates/tauri-plugin-coilbox-uberstress/src/sidecar.rs:160-207`). That makes a full round trip testable. Seeing the emailed code needs a working mail sender in that checkout, and uberserver disables both recovery commands outright when one is not configured (`Protocol.py:4055`). What that takes is confirmed during implementation rather than assumed here, and if it is not reachable the end to end check is the "recovery is disabled" path instead, which is worth covering regardless.

## Files

New:

```
src/account/index.ts
src/account/pages/SettingsSection.tsx
src/lobby-servers/PasswordRecoveryForm.tsx
crates/tauri-plugin-coilbox-multiplayer/permissions/autogenerated/commands/mp_*.toml   (7)
```

Changed:

```
crates/coilbox-lobby-protocol/src/command.rs
crates/coilbox-lobby-protocol/src/message.rs
crates/coilbox-lobby-protocol/src/login.rs
crates/coilbox-lobby-protocol/src/reduce.rs
crates/tauri-plugin-coilbox-multiplayer/src/lib.rs
crates/tauri-plugin-coilbox-multiplayer/build.rs
crates/tauri-plugin-coilbox-multiplayer/permissions/default.toml
src/multiplayer/bindings.ts
src/multiplayer/store.tsx
src/multiplayer/LobbyStatusButton.tsx
src/lobby-servers/pages/SettingsSection.tsx
src/app.plugins.ts
```

No migration, no new persisted settings. Credentials keep using the existing `{serverId, username}` keychain entries through `lsStoreCredential`.

## Done means

- A user who has forgotten their uberserver password completes the flow, learns their username from `RESETPASSWORDACCEPTED`, signs in with the emailed password, and changes it from the account page.
- The same button on a BAR server opens the Teiserver reset page instead of failing.
- Change email completes its code exchange on both servers.
- The recovery controls do not appear on Zero-K or Tachyon.
- All seven CI commands pass, run individually and reported with their output.
