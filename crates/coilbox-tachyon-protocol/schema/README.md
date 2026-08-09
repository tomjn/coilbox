# Vendored Tachyon schema

`compiled.json` is a copy of `schema/compiled.json` from [beyond-all-reason/tachyon](https://github.com/beyond-all-reason/tachyon) at tag `v1.23.0`, with one local patch applied.

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

## Re-vendoring

1. Copy the new `schema/compiled.json` over this one.
2. Re-apply the patch above.
3. Run `cargo test -p coilbox-tachyon-protocol`.

`build.rs` checks the patch is present and fails the build with an explanation if it is not, so step 2 cannot be forgotten silently. If upstream fixes `privateBattle.ip`, delete the check in `build.rs` along with this section.
