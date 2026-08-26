# Zero-K's protocol definitions, vendored

Zero-K's lobby protocol has no published schema. It is defined by C# classes in [ZeroK-RTS/Zero-K-Infrastructure](https://github.com/ZeroK-RTS/Zero-K-Infrastructure), which the server serialises to JSON and sends down the wire. The files here are copies of that C# at one commit, and `build.rs` reads them to generate the crate's Rust types.

Nothing in this folder is edited by hand. Every file is byte-for-byte what upstream has at the commit in `upstream-version.txt`, and `scripts/zerok-refresh.sh` checks that with no arguments.

## What is here and why

`sources.txt` lists the files, under the same paths upstream uses. Three of them declare the commands:

- `Shared/LobbyClient/Protocol/Messages.cs`
- `Shared/LobbyClient/Protocol/MatchMakerMessages.cs`
- `Shared/LobbyClient/Protocol/PartyMessages.cs`

The rest are only there for types those three refer to, and leaving any of them out breaks something specific rather than vaguely:

| File | What it contributes |
| --- | --- |
| `UserBattleStatus.cs` | `SyncStatuses`, the flag that tells a room you have the map. A client that never sends it is announced as still downloading every time somebody starts a game. |
| `ISpringieService/AutohostMode.cs` | `AutohostMode`, which is what a battle's mode is. |
| `Relation.cs` | `Relation`, the friend and ignore values. |
| `IContentService/IContentService.cs` | `NewsItem`, `LadderItem` and `ForumItem`, the three lists the server pushes on connect. |
| `GlobalConst.cs` | `PlanetWarsModes`, which `PwStatus` is typed by. |

`GlobalConst.cs` is mostly server constants that have nothing to do with the wire. It is vendored whole anyway, because a partial copy could not be checked against upstream and would rot without anyone noticing.

## How the C# becomes Rust

`build.rs` reads these files and writes two files into `OUT_DIR`. It generates only what a command can reach, so the HTTP content API in `IContentService.cs` is read and then left alone.

Four rules decide whether the generated types are right. All four are settled by `Shared/PlasmaShared/CommandJsonSerializer.cs` upstream, which is worth reading before changing any of this:

- Its `JsonSerializerSettings` register no string converter, so a C# enum goes over the wire as a number.
- Json.NET writes a `DateTime` as an ISO 8601 string, round-tripping the kind, so it stays a `String` in Rust rather than becoming a type that would refuse an unspecified-kind date.
- `NullValueHandling.Ignore` leaves a null member out of the JSON entirely, so every reference member is `Option<T>` whether or not C# marks it nullable.
- A computed property is derived from members that are already on the wire and the server cannot read one back, so it is not carried.

Anything the reader cannot account for is a build failure with the file and the member named. A type a member refers to that none of these files declares is the most likely one, and the fix is to add the file that declares it to `sources.txt`.

## Refreshing

1. Put the new commit in `upstream-version.txt`.
2. Run `bash scripts/zerok-refresh.sh` and read what it says changed.
3. Run `bash scripts/zerok-refresh.sh --write` to install it.
4. Run `cargo test -p coilbox-zerok-protocol`.
5. Read `git diff` over this folder, and over anything in the workspace that stopped compiling. A field that has moved upstream is meant to show up as a compile error here rather than as a surprise on a live connection.
