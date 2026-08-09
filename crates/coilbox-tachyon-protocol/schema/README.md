# Vendored Tachyon schema

`compiled.json` is `schema/compiled.json` from [beyond-all-reason/tachyon](https://github.com/beyond-all-reason/tachyon), at the tag in `upstream-version.txt`, with one local patch applied and the whole file written back through `jq`.

The bundle is self-contained. Every `$ref` is a local `#/definitions/...` pointer, so `build.rs` needs no network resolver.

## The local patch

`definitions.privateBattle.properties.ip` upstream reads:

```json
"ip": { "$ref": "#/definitions/battleId" }
```

`battleId` is `{"type": "string", "format": "uuid"}`, so the spec says the game server's IP address must be a UUID. The live server sends a real IP address, and `battle/start` is the message that tells us where to connect, so a client generated from the unpatched bundle cannot join a game. The bad `$ref` arrived with the upstream commit "battleId is a uuid" on 2026-06-16.

Our copy reads:

```json
"ip": { "type": "string", "x-coilbox-patched": "see schema/README.md" }
```

`x-coilbox-patched` is an unknown keyword, so JSON Schema validators and typify both ignore it. It is there so the patch is visible when reading or grepping the bundle.

If upstream fixes `privateBattle.ip`, the refresh script stops rather than patching over it. At that point drop the patch, the check in `build.rs` and this section.

## Refreshing

Expect to do this a few times a year. The spec went from 1.20.0 to 1.23.0 in four months, gaining a `checkAssets` request, unit restrictions on lobbies, and a change to the `battleId` type.

The version we are on is `upstream-version.txt`, and `scripts/tachyon-refresh.sh` reads it. Editing that file is how a refresh starts, so a bump is a deliberate act rather than something that arrives with a copied file.

1. Run `bash scripts/tachyon-refresh.sh`. On an unchanged pin it should say the vendored bundle is that version plus the local patch, which tells you the copy has not drifted.
2. Put the new tag in `upstream-version.txt`.
3. Run `bash scripts/tachyon-refresh.sh` again. It is a dry run, and it prints the commands the new version adds and drops, so you can see whether the refresh is routine before taking it.
4. Run `bash scripts/tachyon-refresh.sh --write` to install it.
5. Run `cargo test -p coilbox-tachyon-protocol`, and read anything the build says. The checks below are the ones worth stopping for.
6. Read `git diff` on `compiled.json`. The script writes the bundle through `jq`, so the diff is what upstream changed and nothing else.

Only `src/` is hand-edited upstream. Everything under `schema/` and `docs/` there is generated, so a fix goes into their TypeBox source, never into a bundle.

## What the build stops you on

Three things are quiet enough to be worth failing the build for. All three live in `build.rs`.

The patch marker. A bundle without `x-coilbox-patched` has lost the `privateBattle.ip` patch, and `battle/start` would stop parsing.

An optional and nullable field that `nullable-optional.txt` does not list. Typify writes both "absent" and "present and null" as `Option<T>`, so a generated type for such a field cannot tell leave alone from remove. That is why `lobby/updated` decodes into a hand-written type in `src/merge_patch.rs`. A new one is a decision, not a detail: either the command needs the same treatment, or the field is one nothing reads and you record it and move on.

An `OVERRIDES` entry naming a schema title the bundle no longer has. Upstream renaming a command would otherwise send it back to the lossy generated type without a word.

## What makes a refresh safe

`parse_frame` is total. A command id the bundle does not have lands in `TachyonMessage::Unknown` with the frame kept raw, and a body we cannot read lands in `TachyonMessage::Invalid` the same way, so a server ahead of the vendored bundle does not stop the connection. An enum value the schema does not list, such as a new failure reason, makes that one message `Invalid` rather than breaking anything else.

Match a failure reason by its wire value, never by the generated type name. Typify numbers the `TachyonCommandSubtypeNNNReason` types by position, so the names move whenever the bundle does.

Teiserver lags the spec, so a command that exists in a newer bundle may still answer `command_unimplemented` on the live server.
