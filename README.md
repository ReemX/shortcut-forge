# Shortcut Forge

A [Decky Loader](https://decky.xyz) plugin for adding non-Steam games to your library from Game Mode, without going through Desktop Mode.

Open the Quick Access menu, pick the game's file, and it lands in your library with a clean name, the right Proton version and its official artwork.

## What it does

**Finds the file for you.** The panel has its own file browser. Open a game's folder and the likely executable is marked at the top, while uninstallers, crash reporters and redistributables are moved out of the way. You can also pick from installed applications, Flatpaks included.

**Names the game properly.** `MoonSweepers.exe` becomes Moon Sweepers. Version numbers and tags like `[Repack]` get dropped, and a generic `start.exe` takes its name from the folder. You can still edit it.

**Picks a compatibility tool.** Windows games start on the tool Steam has marked active, then Proton Stable, then Proton Experimental. Anything Steam knows about can be chosen instead, and None stays None.

**Applies official art.** With a free SteamGridDB key it uses the game's own Steam assets where they exist, including where the logo is meant to sit, and falls back to community art. If the match is wrong, correct the title and try again.

**Launch option presets.** 21 named fixes for common problems, each saying what it is for and what it costs. They were checked against the Proton 11 script. You can also save your own under **Your presets** and turn them on for any game.

**No restart needed.** After an add the panel closes and you land on the Non-Steam tab. Steam saves new shortcuts within seconds. Only the shortcut's icon waits for a restart, and you can ask for one under Options.

## Installing

In Decky, turn on Developer Mode under Settings, then use **Install Plugin from URL** with the zip from the [latest release](https://github.com/ReemX/shortcut-forge/releases/latest).

To install by hand, extract the zip into `~/homebrew/plugins/` and run `sudo systemctl restart plugin_loader`.

If you were using Add Non-Steam Games, remove it afterwards. The games you added stay in your library, but settings are not carried over, so you will need to enter your SteamGridDB key again.

## Using it

1. Open the Quick Access menu and select **Shortcut Forge**.
2. Choose **Applications** or **Files** and pick the game.
3. Check the name and compatibility tool. Launch options, presets, an artwork title and a collection are under **More options**.
4. Press **Add to Steam**.

### Artwork

Create a key at [steamgriddb.com/profile/preferences/api](https://www.steamgriddb.com/profile/preferences/api), then under **Options** turn on **Download artwork** and enter it. The on-screen keyboard's paste key works in that field. The key is checked as soon as it is saved.

Art is matched by title. When the name you want differs from the real one, put the real title in **Artwork title**. The shortcut keeps your name.

### Your own presets

Under **More options → Launch option presets**, press **New preset**, give it a name and enter what you would type into Launch options:

```
WINEDLLOVERRIDES="dinput8,version=n,b" %command%
```

It then has a toggle like the built-in ones. Turning it on merges it into whatever the game's launch options already say, and turning it off takes out only what it added. Presets are stored in the plugin's settings file.

## Troubleshooting

**Added, but not confirmed.** Steam took the shortcut but did not read it back correctly, which usually means the client is in a bad state. Restart Steam and add the game again.

**Nothing happens when I launch the game.** Native Linux games need the executable bit. The panel offers **Mark as executable** when it is missing, but a drive mounted `noexec` will refuse it. Windows games need a compatibility tool.

**A game is gone after restarting Steam.** **Options → Load Steam Shortcuts** shows what Steam has saved. This should only follow a crash or power loss right after adding.

**The key will not paste.** Use the on-screen keyboard's own paste key with the field focused. Typing the key in always works.

**No artwork appeared.** The line under **Last added** says why. Press **Check the artwork key** first. A certificate error almost always means the Deck's clock is wrong.

**Wrong artwork.** The **Last added** line names the title that matched. Correct **Artwork title** and press **Try artwork again**.

Logs are at `~/homebrew/logs/Shortcut Forge/plugin.log`. If that folder does not exist the backend never loaded, and `/tmp/plugin_loader.log` has the rest. Please attach the log when reporting a bug. The API key is never written to it.

## Credits

Shortcut Forge started as a fork of [Add Non-Steam Games](https://github.com/danielcamilo1/decky-add-non-steam-games) by Daniel Vergara, which did the hard part of working out Steam's shortcut API, and has since gone its own way. Reading the compatibility tool list follows [decky-wine-cellar](https://github.com/FlashyReese/decky-wine-cellar) (MIT). Built on the [Decky plugin template](https://github.com/SteamDeckHomebrew/decky-plugin-template).

To work on it, see [DEVELOPMENT.md](DEVELOPMENT.md).

## License

BSD 3-Clause, see [LICENSE](LICENSE).
