# pict-section-excalidraw

> **[Read the pict-section-excalidraw Documentation](https://fable-retold.github.io/pict-section-excalidraw/)**

A Pict view that wraps [Excalidraw](https://excalidraw.com) as an embeddable, themable drawing control. Drop it into a `<div>` like any other pict-section.

## Why this exists

Excalidraw is wonderful but it's React-only and lives upstream on GitHub. To insulate the Retold ecosystem from upstream drift (and from GitHub itself disappearing), this module **mirrors the entire Excalidraw repository** into `vendor/excalidraw/`. The mirror has no `.git/` - it's frozen-in-time source we can patch in place and rebuild. Drift is a feature.

## Modes

The view supports two embedding strategies, picked at construction via the `EmbedMode` option:

| Mode | When to use | Trade-off |
|---|---|---|
| `react` (default) | Best theme conformance, smallest bundle if your app already loads React. Mounts `<Excalidraw>` into the destination div via `ReactDOM.createRoot`. | Adds React + ReactDOM to the page's runtime. |
| `iframe` | Total CSS isolation. Useful when host app has aggressive global styles you don't want bleeding into Excalidraw. | Theme passed via `postMessage`, slightly more API plumbing. |

Both modes share the same public API.

## Public API

### Configuration options

```javascript
{
    EmbedMode: 'react',                       // or 'iframe'
    TargetElementAddress: '#Excalidraw-Container',
    DrawingDataAddress: 'AppData.Drawing',    // optional AppData binding
    Theme: 'light',                           // 'light' | 'dark' | 'auto' (follow pict theme)
    FormFactor: 'auto',                       // UI density — see below
    ViewModeEnabled: false,
    ZenModeEnabled: false,
    GridModeEnabled: false,
    LangCode: 'en',
    UIOptions: { /* Excalidraw UIOptions */ },
    InitialData: { elements: [], appState: {}, files: {} },
    AssetBaseURL: './excalidraw-assets/',     // fonts + locales
    OnLoad: (pView, fCallback) => { /* fCallback(err, sceneData) */ },
    OnSave: (pView, pSceneData, fCallback) => { /* fCallback(err) */ },
    OnChange: (pView, pSceneData) => { /* throttled change notify */ }
}
```

### FormFactor — UI density in a small embed

Excalidraw picks how dense its UI should be from the size of the **container**
it is mounted in: roughly `width <= 599 || (height < 500 && width < 1000)` reads
as a phone, and a phone gets the mobile styles panel, where the shape properties
collapse behind a popover instead of the left-hand island.

That is right for excalidraw.com, where the container *is* the viewport, and
wrong for an embed, where the container is a box on a page — possibly a few
hundred pixels tall on a large monitor driven by a mouse.

| Value | Behaviour |
|---|---|
| `'auto'` *(default)* | Excalidraw decides. Stock behaviour. |
| `'pointer'` | Desktop chrome when the primary pointer is fine (a mouse); Excalidraw's own answer on a touch screen, where the mobile UI is genuinely better. |
| `'desktop'` / `'tablet'` / `'phone'` | Pin it. |

Implemented over Excalidraw's own `UIOptions.getFormFactor(width, height)` hook.
A host that supplies its own `UIOptions.getFormFactor` keeps it — this never
overwrites one. In `iframe` mode the *mode string* crosses `postMessage` (a
function is not structured-cloneable) and the host page rebuilds the resolver
inside the frame.

### Sizing

`.pict-excalidraw-wrap` floors itself at
`var(--pict-excalidraw-min-height, 320px)`. Set that variable on (or above) the
wrap to let a host that sizes the control itself — a form field with a resize
grip, say — go below the default floor.

### Methods

```javascript
view.getScene()                  // -> { elements, appState, files }
view.setScene(sceneData)         // void
view.exportSvg(opts)             // -> Promise<SVGElement>
view.exportBlob(opts)            // -> Promise<Blob>  (PNG)
view.serialize()                 // -> JSON string of the current scene
view.setTheme('light'|'dark')    // void
view.setReadOnly(bool)           // void
view.load()                      // re-invokes OnLoad and applies result
view.save()                      // invokes OnSave with current scene
view.destroy()                   // teardown
```

### Override loading & saving

Pass `OnLoad` and `OnSave` callbacks to plug into whatever storage layer you want - local files, a Meadow record, IndexedDB, or a remote API. If you don't pass them, the view defaults to reading/writing the AppData address you bind via `DrawingDataAddress`.

```javascript
{
    OnLoad: (pView, fCallback) =>
    {
        fetch('/api/diagrams/42').then(r => r.json()).then(d => fCallback(null, d));
    },
    OnSave: (pView, pSceneData, fCallback) =>
    {
        fetch('/api/diagrams/42', { method: 'PUT', body: JSON.stringify(pSceneData) })
            .then(() => fCallback(null));
    }
}
```

## Theme conformance

The view's chrome uses `pict-section-theme` CSS custom properties (`--theme-color-*`). Excalidraw's own canvas chrome is themed via a CSS bridge that maps pict tokens to Excalidraw's internal vars. Switching the pict theme retints Excalidraw without re-rendering.

In `iframe` mode, theme tokens are piped through `postMessage` and re-applied as CSS variables on the iframe document.

## Vendor mirror

<!-- bespoke diagram: edit diagrams/vendor-mirror.mmd or .hints.json, then: npx pict-renderer-graph build modules/pict/pict-section-excalidraw -->
![Vendor mirror](diagrams/vendor-mirror.svg)

Run `npm run build:vendor` to rebuild from `vendor/excalidraw/`. That is the
heavy, occasional step (only needed on an Excalidraw upstream bump) and it
requires the yarn toolchain inside `vendor/excalidraw/`:

```bash
corepack enable
( cd vendor/excalidraw && yarn install && yarn build:packages )
npm run build:vendor
```

## Publishing

The runtime does not load the iframe host from `source/iframe-host/`. It loads
the copies the vendor build drops into `vendor/excalidraw-built/` (consuming
apps deploy that whole directory). So editing `source/iframe-host/*` without
re-mirroring it leaves the shipped copy stale.

`npm publish` runs the `prepublishOnly` gate (`scripts/Prepare-Publish.js`)
automatically. It:

1. Re-copies `source/iframe-host/*` into `vendor/excalidraw-built/` so the
   shipped iframe host can never lag the source (it warns if it had to).
2. Verifies the heavy committed bundles (`excalidraw-wrapper.min.js`,
   `react-vendor.min.js`, the CSS, the fonts/locales asset trees) are present
   and non-trivial, and hard-fails the publish if any are missing.

Run `npm run verify:publish` any time to dry-check the tree without publishing.

To cut a new release:

```bash
npm run verify:publish          # sync + verify (also run automatically on publish)
git add -A && git commit -m "..." # commit any refreshed vendor/excalidraw-built/ files
npm version patch               # bump (npm will not republish an existing version)
npm publish                     # prepublishOnly gate runs here too
```

## Demos

```bash
cd example_applications/full_browser_excalidraw && npm install && npm start
cd example_applications/embedded_excalidraw     && npm install && npm start
```
