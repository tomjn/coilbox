# Choosing which install represents a game in the hub catalog

Coilbox reads the games on a computer and tells the hub what units each one has. Somebody who has three installs of Balanced Annihilation sends facts for one of them, because the hub holds one set of current facts per game. This is about which one it picks.

Today it picks the wrong one, and the wrong one is public.

## The problem

`gamesToSend` in `src/hub/games/factsSweep.ts` keeps one install per shortname by taking the greatest game name as a string:

```ts
} else if (game.name > held.game.name) {
```

A name holding `test-` always wins that comparison. In ASCII `t` is 116, `V` is 86 and `9` is 57, so `Balanced Annihilation test-7183-001edc3` beats `Balanced Annihilation V15.9.8`, and `XTA test-1274-006fa06` beats `XTA 9.728`. On a library with a rapid pool the catalog would say a game's current release is a commit snapshot somebody happened to download.

Two things are wrong rather than one. The comment above that line says the choice is on the archive name, and the code reads the game name, so they disagree. Making them agree would not help: by archive name Balanced Annihilation is `balanced_annihilation-v15.9.8.sdz` against `cc956b0843d10d3689e2558281587c83.sdp`, and `b` sorts before `c`, so the snapshot still wins. Rapid archives are named after an md5, so no comparison of strings can tell a release from a snapshot.

## What the catalog entry means

A game's entry describes its current public release, as its players know it. A commit snapshot is a private build. It never represents the game, even when it is the only install on the machine. A game with nothing but snapshots is left out of the catalog rather than described by one.

## The rule

An install represents its game only if it is a public release.

- An archive that is not a rapid package is a release. A `.sdz` or `.sd7` is something an author packaged and published.
- A rapid package, meaning a `.sdp`, is a release only when a named tag points at its md5.

A named tag is any tag that is not a `<repo>:git:<sha>` commit, which in code means the tag does not hold `:git:`. Rapid records this itself, one line per tag in each repository's `versions.gz`, as `tag,md5,depends,longname`:

```
ba:git:001edc3f1e20b49370b5432153bea3e43e5fafef,cc956b0843d10d3689e2558281587c83,,Balanced Annihilation test-7183-001edc3
ba:stable,1df3ea4654d1f1f381e3534bfb1cbdb3,,Balanced Annihilation V15.9.8
ba:test,dd57d8bc4e04ce8edee09a9cf84bbc04,,Balanced Annihilation V15.9.8
```

The installed package `cc956b08…` is reachable only from a `git:` tag, so it is a snapshot. The md5 in a pool archive's filename is the md5 in `versions.gz`, so the join is a plain lookup.

Reading the tag beats reading the name. Here the tag called `ba:test` points at the released V15.9.8, while the build *named* `test-7183-001edc3` is the snapshot. A rule that matched on the word test would get both backwards.

This keeps a contributor whose only Beyond All Reason install came from `byar:stable` useful, which matters because rapid is how most people install that game. A rule that refused every rapid package would be simpler and would keep the largest game in the ecosystem out of the catalog for everyone.

## What changes

### A command that reads the local rapid tags

`rapid_release_archives` in `tauri-plugin-coilbox-downloads`, which already owns rapid and already parses this format.

It takes a data directory, walks `<dataDir>/rapid/*/*/versions.gz`, inflates each file with the `flate2` dependency that is there for fetching the same files over HTTPS, and parses each with the existing `parse_versions` rather than a second parser. It answers with the md5s that at least one named tag points at.

Answering with only the named-tag md5s keeps it small. Balanced Annihilation's file holds thousands of `git:` lines and two named ones.

A data directory with no `rapid` folder answers with an empty set. That is a machine with no pool, not a failure, and it leaves every non-rapid install untouched.

### The rule in `gamesToSend`

`gamesToSend` takes the release md5 set as a second argument. After the existing checks for a development folder, a missing shortname and a missing version, a `.sdp` whose filename stem is not in the set is skipped with a new reason, `snapshot-build`.

The one-install-per-shortname tie-break is unchanged. Once snapshots are gone it is choosing between real releases, and its job is only to make the same choice every run.

### The sweep

`sweepGameFacts` asks for the set once, before it scans, and passes it down. `GameSweepTools` gains the call so a test can still count what the sweep reaches for.

## Testing

Rust, in the downloads plugin:

- a rapid tree with named and `git:` tags answers with only the named md5s
- a repository with nothing but `git:` tags contributes nothing
- a data directory with no rapid folder answers with an empty set

Frontend, on `gamesToSend`:

- a shortname whose only install is a snapshot is skipped as `snapshot-build`, not sent
- a rapid package a named tag points at is kept
- a `.sdz` beside a snapshot wins, whatever the two names sort like

## What this does to a real library

On the machine this was found on, with 16 games installed:

- Balanced Annihilation is sent as `V15.9.8` rather than `test-7183-001edc3`, and both its snapshots are skipped
- XTA is sent as `9.728 patch 1` rather than `test-1274-006fa06`
- Beyond All Reason stays, and is sent as `test-30922-8064a43`
- sendable stays at 9 games

Beyond All Reason is worth explaining, because it looks like the rule failing and is the rule working. Its installed package is reachable from `byar:test` as well as from a commit tag, and `byar:test` is a named channel BAR publishes rather than a private build. The alternative on this machine is `byar:stable`, which points at "Beyond All Reason 0.01", a stale placeholder that would be far worse to publish.

So its page reads `test-30922-8064a43` as the release. That is BAR's own version string for the build people actually run, not something coilbox invented.

## Out of scope

Letting somebody choose which install speaks for a game. That is a per-game control in the settings page, and the rule above answers correctly without asking anybody anything.
