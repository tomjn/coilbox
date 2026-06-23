Always prefer shadcn components over native input controls. picoframe
(`@picoframe/frame`) is built on shadcn, so its exports `Button`, `Input`, and
`cn` are the shadcn primitives — use those rather than native elements.

For controls the frame doesn't export (`select`, `checkbox`, `textarea`), use
the token-styled wrappers in `src/uberstress/pages/components/ui.tsx`
(`Select`, `Checkbox`, `Textarea`) — they match `Input`'s styling and are native
underneath, the same approach picoframe takes for `Input`.

## Releases

The release version comes from the git tag, not from source. CI
(`.github/workflows/release.yml`) writes the pushed tag (e.g. `0.2.0`) into
`tauri.conf.json` at build time via `jq`; in source the version stays a `0.0.0`
placeholder. To cut a release, push a `N.N` or `N.N.N` tag at the release commit
— no manual version bump is needed. (`package.json` / Cargo versions are not
used for the artifact version.)
