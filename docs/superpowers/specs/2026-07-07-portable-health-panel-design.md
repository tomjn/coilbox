# Portable-mode health panel — design

## Problem

Setting up a portable Coilbox distribution is a file-fiddling loop with no feedback: an author hand-writes `.coilbox/profile.json`, relaunches, and eyeballs the result. When something is wrong — a malformed profile, a game filter that matches nothing, a content root that won't travel with the package, a read-only folder that silently blocks downloads/updates — Coilbox fails soft and says nothing. The author has no in-app way to see *what state they're in* or *what's misconfigured*.

This is the "A" of an agreed "A then B" sequence (A = diagnostics panel, B = a profile editor GUI, a later PR). It targets a non-technical game author (the immediate case: Splinter Faction) and doubles as an end-user support surface.

## Goal

Extend the existing, always-visible **Settings > Distribution profile** section with a **health checklist**: a list of checks, each a row showing status (OK / warning / error / unknown), a one-line label, and a short fix hint when not OK. It reads like a "doctor" report — what's wrong and what to do.

Non-goals: editing anything (that's B), fixing problems automatically, or any new nav item.

## Placement

Below the current facts summary in `src/profile/SettingsSection.tsx`. The section stays always-visible (support can still answer "where did the Games tab go?"). When no profile is loaded and the install is not portable, the checklist still renders the checks that make sense for a vanilla install (e.g. writable folders) — it is a portable-*and*-general health view, not gated on a profile existing.

## The checks

Eight checks. Six compose existing data with no backend change; two need new plumbing (marked).

1. **Portable mode** — active + resolved `.coilbox` path. Source: `getProfileRoot()` (`src/profile/profile.ts`); non-empty ⇒ portable. Status: informational (OK when portable, neutral "Not portable" otherwise).
2. **Profile source / parse error** — where `profile.json` loaded from, or the parse error. Source: `getProfileSource()` plus a **new** `getProfileError()`. *(New plumbing: FE — see below.)*
3. **Content roots** — each root listed Portable or Absolute, so the author sees what travels with the package. Source: content plugin state `state.roots` (each carries `path` + `portable`). Status: warn if portable mode is on but no root is portable (nothing would ship).
4. **Game filter reality check** — "matches N installed games" (0 ⇒ warn) and an invalid-regex warning. Source: `getProfile().gameFilter` + `dlInstalledContent({ paths })` for the game set; invalid regex detected by re-running `new RegExp(f.regex, "i")` in the check. No backend change.
5. **Write root portable** — warn when the Downloads write root isn't inside the package, because GitHub-release updates would then land outside it. Source: `useWriteRootPath()` compared against the app dir (`dirname` of `getProfileRoot()`). Only meaningful in portable mode.
6. **Bundled campaign load errors** — warn when a bundled/local campaign fails to parse. Source: `campaignList()` returns each campaign's raw JSON, and the schema-agnostic plugin passes malformed files through as-is; the frontend validates each with `parseCampaignJson(item.json)` (`src/campaign/model.ts:193`, returns `null` on bad shape) and counts the failures. No backend change. (Rare files the Rust plugin can't even read are out of scope.)
7. **Playable content present** — warn when no engine or no games were found (an empty package). Source: content plugin state (engines under roots) + `dlInstalledContent` (games). Reuses data the download screens already read.
8. **Folders writable** — probe the Downloads write root and `.coilbox/data` for writability; a read-only folder silently blocks downloads and updates. *(New plumbing: new Rust command `dl_path_writable` — see below.)*

## Architecture

Three units, each independently understandable/testable.

### `useHealthChecks()` — the one place check logic lives

A hook that gathers inputs (profile getters, content state, installed content, write root, writable-probe results) and returns `HealthCheck[]`:

```ts
type HealthStatus = "ok" | "warn" | "error" | "unknown";
interface HealthCheck {
  id: string;          // stable, e.g. "portable", "profile", "writable"
  label: string;       // "Game filter matches 2 installed games"
  status: HealthStatus;
  hint?: string;       // shown only when status is warn/error
}
```

The *derivation* from inputs to statuses is a pure function (`deriveHealthChecks(inputs): HealthCheck[]`) so it can be unit-tested without React or Tauri. The hook is a thin wrapper that fetches the async inputs (installed content, writable probe) and feeds them in.

### `HealthChecklist.tsx` — dumb renderer

Renders `HealthCheck[]`: a status dot, the label, and the hint when present. No logic beyond mapping status → colour/icon. Dropped into `ProfileSettings` under the facts `<dl>`.

### Backend / module additions

- **`getProfileError()`** in `src/profile/profile.ts`. `loadProfile()` already catches parse failures (`profile.ts:181`) and transport failures (`:188`) and falls back to empty. Retain the message in a module singleton (`loadedError: string | null`) and expose it. No Rust change; `profile_load` already returns the raw `json`/`source`, so a `source === "file"` with a retained parse error is the "file present but unparseable" signal.
- **`dl_path_writable({ path }) → { writable: boolean; error?: string }`** in the downloads plugin (`crates/tauri-plugin-coilbox-downloads`). Probe = create a temp file in the dir, delete it; map failure to `{ writable: false, error }`. Needs its `build.rs` COMMANDS entry + `permissions/default.toml` (per the project's ACL rule). FE binding in `src/downloads/bindings.ts`.
- **No campaign backend change.** Check #6 is frontend-only: it runs `campaignList()` and filters items where `parseCampaignJson(item.json)` is `null`, grouping the count by `item.source` (`bundled` / `local`). `CampaignListItem` carries no filename, so the check reports a count, not per-file names.

## Data flow

```
profile.ts getters ┐
content plugin state ┤
dlInstalledContent   ├─→ deriveHealthChecks(inputs) → HealthCheck[] → HealthChecklist
useWriteRootPath     ┤        (pure)                                        ↑
dl_path_writable     ┤                                              ProfileSettings
campaignList+parse   ┘
```

## Error handling & states

- **Fail soft, per check.** Any input that can't be read yields `status: "unknown"` (neutral dot) for that check only — never a thrown error or a blank panel.
- **Async checks** (installed content, writable probe) render a loading state on their rows until resolved; the rest of the checklist renders immediately.
- **Non-portable install:** check #1 shows "Not portable"; checks that are portable-specific (#3 portable-roots warning, #5 write-root-portable) render as neutral/informational rather than warnings, since they don't apply.

## Testing

- **`deriveHealthChecks` unit tests** (pure, no mocks beyond input objects) covering: no profile; profile parse error; game filter matching 0 games; invalid filter regex; portable mode with only absolute roots; write root outside the package; a read-only folder; a bundled campaign error; empty package (no engine/games).
- **Rust probe unit test** for `dl_path_writable`: a writable temp dir returns `writable: true`; a path that can't be written returns `writable: false` with an error.
- Renderer is trivial (status → icon) and covered implicitly; no dedicated test unless it grows logic.

## Out of scope / deferred

- Profile *editing* (feature B, next PR).
- Auto-fix actions (e.g. "make write root portable" button) — the panel diagnoses; it does not mutate.
- A dedicated nav item or a standalone Diagnostics section — revisit only if the panel outgrows the profile section.
