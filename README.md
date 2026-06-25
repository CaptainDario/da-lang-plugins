# da-lang-plugins

Plugins and packs for DaLang-based applications (DaKanji, …).

## File types

| ext | what it is |
| --- | --- |
| `.dap` | the plugin **script** (the code) |
| `.dapm` | a single plugin's **metadata** sidecar |
| `.dapp` | a plugin **pack** — a manifest listing one or more plugins |

Pack manifests are JSON, so `.dapp` and `.json` are interchangeable endings — a
pack's `index.json` is a `.dapp`.

## Layout

```text
packs/
  <pack>/
    index.json                 ← the pack manifest (.dapp)
    plugins/
      <plugin-id>/
        plugin.dapm            ← metadata sidecar
        script.dap             ← the script
```

A pack manifest lists its plugins inline, each with a `codeUrl` pointing at the
`.dap` (relative to the manifest, or an absolute URL). A pack holds **one
family** — set the manifest's top-level `family` (or let it be inferred from the
members); a mismatched plugin makes the install throw.

## Packs

- **default** (`da.default`) — ships with the app. Its manifest is published in
  the version-pinned DaKanji-Data release as `dalang_default.dapp`; updates are
  pulled from this repo's `main`.
- **examples** (`da.examples`) — reference plugins covering every API surface;
  loaded in debug builds.
- **extended** (`da.extended`) — extra plugins unlocked by purchase.

## Errors & the plugin console

Plugins log through `da.log(level, tag, message)` (`level` = `debug` / `info` /
`warn` / `error`). The default plugins send every caught error to this channel as
`da.log('error', '<plugin>', …)`, so a broken plugin reports instead of failing
silently.

Watch the logs live in the app:

1. Enable **Settings → Advanced → local plugin development**.
2. In the in-app browser, open the **⋯** menu and choose **Plugin console**.
3. The console streams each plugin's `da.log` / `da.emit` output, tagged by plugin
   and level — filter to `error` to spot failures.

## CI

`.github/workflows/build-default-pack.yml` downloads the latest stable Yomitan,
bundles the default text-selection plugin into a single `script.dap`
(`scripts/build-text-selection.mjs`), and commits the result.
