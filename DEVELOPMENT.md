# Developing Shortcut Forge

Requires Node.js 16.14+ and `pnpm` 9+.

```bash
pnpm install
pnpm run build     # compiles src/ to dist/index.js
pnpm run watch     # rebuild on change
pnpm run package   # produces out/<name>-v<version>.zip, needs the zip command
pnpm test          # naming and launch preset logic
python3 -B tests/backend_presets.py   # preset storage, without Decky
python3 -B tests/backend_update.py    # reading GitHub releases, without Decky
python3 -B tests/backend_apps.py      # which desktop entries get listed, without Decky
```

The frontend lives in `src/`:

- `index.tsx` — the Quick Access panel.
- `store.ts` — the in-progress selection, held outside React (see below).
- `FileBrowser.tsx` — the in-panel file browser.
- `gameName.ts` — works out a game's name from its file and folder.
- `launchPresets.ts` — the built-in presets, custom presets, and the launch options editing behind both.
- `LaunchPresetList.tsx` — the launch options screen, and the custom preset editor.
- `ArtCard.tsx` — the art preview on the form, and the artwork screen.
- `update.ts` — hands an update to Decky's installer.
- `LocationList.tsx` — the Places/Drives rows.
- `ListRow.tsx` — the row, group and disclosure primitives the lists are built from.
- `ProgressRow.tsx` — the artwork progress bar, drawn from plain elements (see below).
- `TextEntry.tsx` — the text field every form uses (see below; do not use `TextField` directly).
- `SavedGames.tsx` — the *Load Steam Shortcuts* list.
- `RestartPrompt.tsx` — the post-add restart dialog.
- `version.ts` — the build number, compared against the backend's at startup.
- `steam.ts` — shortcut creation against Steam's own `SteamClient.Apps` API.
- `compatTools.ts` — reads the compatibility tool list from Steam's CompatManager service.
- `artwork.ts` — drives the SteamGridDB download slot by slot, reporting progress.
- `backend.ts` / `pathinfo.ts` — typed bindings to `main.py`, and the local fallback used when the backend is unreachable.

### The Quick Access panel unmounts under you

Decky renders plugin content only while the panel is visible, so hiding it destroys the component tree and every bit of React state in it — and opening the file picker hides it. `alwaysRender: true` keeps the tree mounted, and the in-progress selection lives in `store.ts`, a module-level object with a subscription hook, so it survives an unmount even if one happens. Anything that has to outlive a modal belongs there rather than in `useState`.

`main.py` is the Python backend: it inspects picked paths, sets the executable bit, enumerates user directories and drives, lists folders, stores preferences, fetches artwork and parses `shortcuts.vdf`.

### The plugin's `window` is not the panel's `window`

Plugin JavaScript runs in a different context from the window it renders into. The global `document` is not the one holding the panel, so `document.hasFocus()` is always false and a document-wide query cannot see the panel's own elements. Anything touching focus, events or element lookup has to resolve its window and document from a node that is actually in the panel — `node.ownerDocument`, never the global; across that boundary prefer `contains()` and `tagName` over `instanceof`.

### Styling, focus and selection

Steam paints gamepad focus onto a button's own surface, so an inline `background`, `border` or `box-shadow` outranks it and swallows the highlight — the user can no longer see what pressing A would do. Steam's class names are hashed at build time, so take them from `@decky/ui`'s class modules instead of writing strings.


### `@decky/ui` components are matched against Steam's bundle

Every component `@decky/ui` exports is one of Steam's own, found at runtime by string-matching its minified code — so a client update can leave an export `undefined`, and rendering that throws.

Keep resolved components off the path of background work. The throw comes back out through the `setState` that reported progress (Steam's React 16 renders those synchronously) and abandons the job: a progress bar that cannot draw itself takes the download with it. `ProgressRow` is a `<div>` and a percentage for that reason, and `fetchArtwork` wraps its progress callback so a UI failure cannot reach the work.

### Text fields need `TextEntry`

Use `TextEntry` for any text field; a bare `TextField` silently eats pastes. The on-screen keyboard pastes **natively**, below React — the element's value changes without a change event, so the next render restores the old value. `TextEntry` watches the real `<input>` instead (`input`, a deferred `paste`, `beforeinput`, and a poll for a value that changes with no event at all) and renders an offscreen input of its own, because `SteamClient.Browser.Paste()` needs a focused editable element.

There is no clipboard outside Steam to fall back on: gamescope implements no `wl_data_device_manager`, so the client's internal one is all there is and the on-screen keyboard is the only thing that reaches it. Every in-panel route around that — `navigator.clipboard.readText()`, `execCommand("paste")`, a backend read via `wl-paste`/`xclip` — was tried and removed in 1.7.10; the keyboard's paste key lands correctly once `TextEntry` is watching the field, which is the whole fix.

### Notes on SteamGridDB

- **Do not write library art into `userdata/<account>/config/grid` yourself.** That is the desktop-tool approach (BoilR, Steam ROM Manager) and a running Steam does not notice it. Apply art with `SteamClient.Apps.SetCustomArtworkForApp(appId, base64, 'png', assetType)` — `ELibraryAssetType` being 0 capsule, 1 hero, 2 logo, 3 header, 4 icon — preceded by `ClearCustomArtworkForApp` and a 500 ms wait, since `Set` will not replace existing art and `Clear` resolves before it has finished. [SteamGridDB's own plugin](https://github.com/SteamGridDB/decky-steamgriddb) is the reference worth reading.
- `'png'` is passed whatever the asset really is: that argument names the file Steam writes, not the format it decodes. A shortcut with no saved logo position renders its logo blank, so a default one is written after applying a logo.
- The icon is the exception, being a path in `shortcuts.vdf` rather than library art: it is written to the grid folder of the account from `MostRecent` in `loginusers.vdf` and applied with `SetShortcutIcon`, only when the shortcut has no icon, and only visible after a restart.
- **Every HTTPS request needs Decky's SSL context** (`from helpers import get_ssl_context`). The plugin sandbox has no CA bundle Python can find, so anything else fails with `CERTIFICATE_VERIFY_FAILED`.
- The backend splits the work into `find_artwork` and one `download_artwork_slot` per slot so progress can be reported, `list_artwork` reads the folder back as proof the art was accepted, and `artwork.ts` keeps a `DEFAULT_SLOTS` fallback — a loop over an empty slot list downloads nothing and reports no error. Downloads block, so they go through `asyncio.to_thread`, and the API key is never written to the log.

### Notes on Steam's shortcut API

- `AddShortcut` is called as `AddShortcut(name, exe, "", "")` — name and exe only, since some builds return `0` when given a start dir or launch options. Those are written afterwards with the `Set*` calls, which silently do nothing until `appStore` knows the app, hence the poll between them.
- **The target must be quoted; the start directory must not.** An unquoted target produces a shortcut that looks right in the library and then fails to launch. Confirmed on hardware.
- `Set*` calls return nothing, so the shortcut is read back through `RegisterForAppDetails` and compared against what was asked for; a mismatch is surfaced to the user rather than swallowed.
- On current clients the shortcut, its launch options and its compatibility tool all reach disk within seconds (`shortcuts.vdf` and `config.vdf`), so no restart is needed. Older documentation saying otherwise is out of date. `SteamClient.User.StartRestart(false)` is still how to restart from Game Mode, which makes a new icon appear.
- Collections go through the untyped `collectionStore` global: `NewUnsavedCollection(name, undefined, [])`, then `AsDragDropCollection().AddApps([overview])` and `await Save()`. `AddApps` takes app overviews, not appIds.

### Testing on a Deck

Steam's CEF debugger listens on port 8080 on the Deck, so `ssh -L 18080:127.0.0.1:8080 deck@steamdeck` lets a script drive the real UI. `tests/deck-cdp-lib.mjs` connects to a target by title (`SharedJSContext`, `QuickAccess_uid2`) and evaluates in it. From `SharedJSContext`, `DeckyBackend.call('loader/call_plugin_method', 'Shortcut Forge', 'method', ...args)` reaches the live backend.

`node tests/deck-journey.mjs` walks the panel with real button presses, sent through `FocusNavController.DispatchVirtualButtonClick`, and takes screenshots with `gamescopectl` into `shots/`. It fails if a screen stops fitting, the list stops moving evenly, or going back takes more presses than it should. It expects an ssh host called `steamdeck`, and a game folder as the first row under Places, which is the folder last picked from. Do not use `element.click()` to drive the UI: focus and the selected highlight then do not behave as they do under a controller, and bugs hide.

Do not edit `settings.json` while the plugin runs: the backend holds it in memory and writes over your change. Restarting `plugin_loader` can also leave another plugin's backend holding its port, so check the other plugins afterwards.
