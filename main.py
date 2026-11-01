import asyncio
import base64
import glob
import json
import os
import re
import shlex
import ssl
import stat
import time
import urllib.error
import urllib.parse
import urllib.request

import decky

try:
    # Decky Loader bundles certifi and hands its SSL context out through this
    # module. Nothing else in the plugin sandbox has a CA bundle Python can
    # find, so an HTTPS request made without it fails every time with
    # CERTIFICATE_VERIFY_FAILED — "unable to get local issuer certificate".
    from helpers import get_ssl_context  # type: ignore
except ImportError:  # not running under the loader, e.g. the tests
    get_ssl_context = None

# Extensions that need a compatibility tool (Proton) to run on Linux.
WINDOWS_EXTENSIONS = {".exe", ".bat", ".cmd", ".msi"}

# Extensions that are never launchable on their own. Selecting one of these is
# almost always a mistake, so the frontend warns about it.
NON_EXECUTABLE_EXTENSIONS = {
    ".dll", ".so", ".zip", ".7z", ".rar", ".tar", ".gz", ".iso",
    ".txt", ".md", ".png", ".jpg", ".jpeg", ".ini", ".cfg", ".json",
}

SETTINGS_FILENAME = "settings.json"

# Shown in the panel so a stale install is obvious. Keep in sync with package.json.
PLUGIN_VERSION = "2.1.0"

RELEASES_API = "https://api.github.com/repos/ReemX/shortcut-forge/releases/latest"
RELEASES_DOWNLOAD = "https://github.com/ReemX/shortcut-forge/releases/download/"
RELEASES_PAGE = "https://github.com/ReemX/shortcut-forge/releases/latest"
# Opening the panel should not ask GitHub every time, and it limits anonymous calls.
UPDATE_CHECK_SECONDS = 6 * 60 * 60
UPDATE_CHECK_TIMEOUT = 10

CUSTOM_PRESET_MAX_COUNT = 100
CUSTOM_PRESET_MAX_ALIAS = 80
CUSTOM_PRESET_MAX_OPTIONS = 2000

# "ask" prompts after every add; "always"/"never" skip the prompt.
RESTART_CHOICES = ("ask", "always", "never")

SGDB_API = "https://www.steamgriddb.com/api/v2"

# Where a user gets the personal API key SteamGridDB requires. Shown in the
# panel, so keep it copy-typeable rather than a full URL.
SGDB_KEY_URL = "steamgriddb.com/profile/preferences/api"

SGDB_TIMEOUT = 20

# No piece of library artwork is legitimately this large. The cap only exists so
# a surprising response cannot fill the Deck's disk.
MAX_ARTWORK_BYTES = 12 * 1024 * 1024

# Steam's `ELibraryAssetType`, the slot argument to `SetCustomArtworkForApp`.
# Steam applies library art through that call and updates the library there and
# then; only the icon still goes through a file and needs a restart.
ASSET_CAPSULE = 0
ASSET_HERO = 1
ASSET_LOGO = 2
ASSET_HEADER = 3
ASSET_ICON = 4

# The artwork slots filled for a shortcut: label, SteamGridDB endpoint, the
# filename suffix Steam stores that slot under in its grid folder, the dimensions
# to ask SteamGridDB for, and Steam's own `ELibraryAssetType` for the slot.
#
# Dimensions narrow the search to what Steam actually displays — grids are
# fetched twice, once portrait for the library capsule and once wide for the
# shelves and the Recent games row.
#
# The suffixes are only used to read the folder back as evidence; Steam writes
# those files itself in response to `SetCustomArtworkForApp`. The icon is the
# exception and is written here, since a shortcut's icon is a path Steam stores
# in `shortcuts.vdf` rather than library art.
ARTWORK_KINDS = (
    ("grid", "grids", "p", "600x900,342x482,660x930", ASSET_CAPSULE),
    ("wide grid", "grids", "", "460x215,920x430", ASSET_HEADER),
    ("hero", "heroes", "_hero", "", ASSET_HERO),
    ("logo", "logos", "_logo", "", ASSET_LOGO),
    ("icon", "icons", "_icon", "", ASSET_ICON),
)

# Extensions Steam recognises for that artwork. A download keeps whatever the
# asset really is; the other extensions for the same slot are deleted, since a
# leftover from an earlier download would otherwise compete with the new file.
ARTWORK_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".ico")

# userdata folders are named with the account id, which is the low 32 bits of
# the 64-bit SteamID that loginusers.vdf records.
STEAM_ID64_BASE = 76561197960265728

# A 64-bit SteamID as it appears as a group heading in loginusers.vdf.
LOGIN_USER_ID = re.compile(r'^\s*"(\d{17})"\s*$')

LOGIN_USER_MOST_RECENT = re.compile(r'^\s*"MostRecent"\s+"1"\s*$')

# XDG keys we offer as places, in the order they are shown.
XDG_PLACES = (
    ("XDG_DOWNLOAD_DIR", "Downloads", "downloads", "Downloads"),
    ("XDG_DOCUMENTS_DIR", "Documents", "documents", "Documents"),
    ("XDG_DESKTOP_DIR", "Desktop", "desktop", "Desktop"),
    ("XDG_PICTURES_DIR", "Pictures", "pictures", "Pictures"),
    ("XDG_VIDEOS_DIR", "Videos", "videos", "Videos"),
    ("XDG_MUSIC_DIR", "Music", "music", "Music"),
)

# Extra directories worth offering when they exist.
EXTRA_PLACES = (
    ("Games", "games", "Games"),
    ("Applications", "applications", "Applications"),
    ("Emulation", "games", "Emulation"),
)

# Where removable and external media get mounted.
REMOVABLE_MOUNT_ROOTS = ("/run/media", "/media", "/mnt")

# Filesystems that never hold a game and only add noise to the drive list.
PSEUDO_FILESYSTEMS = {
    "autofs", "bpf", "cgroup", "cgroup2", "configfs", "debugfs", "devpts",
    "devtmpfs", "efivarfs", "fuse.gvfsd-fuse", "fusectl", "hugetlbfs", "mqueue",
    "proc", "pstore", "ramfs", "securityfs", "sysfs", "tmpfs", "tracefs",
}


# Markers in Steam's binary KeyValues format (shortcuts.vdf).
VDF_MAP = 0x00
VDF_STRING = 0x01
VDF_INT32 = 0x02
VDF_END = 0x08


# /proc/mounts octal-escapes exactly these four characters in paths.
MOUNT_ESCAPES = {"\\040": " ", "\\011": "\t", "\\012": "\n", "\\134": "\\"}


def _unescape_mount(value: str) -> str:
    for escape, character in MOUNT_ESCAPES.items():
        value = value.replace(escape, character)
    return value


def _unescape_udev(value: str) -> str:
    """udev writes by-label symlinks with \\xNN escapes, e.g. 'My\\x20SD'."""
    return re.sub(r"\\x([0-9a-fA-F]{2})", lambda match: chr(int(match.group(1), 16)), value)


def _parse_binary_vdf(data: bytes) -> dict:
    """Minimal reader for Steam's binary KeyValues, enough for shortcuts.vdf."""
    index = 0

    def read_string() -> str:
        nonlocal index
        end = data.index(b"\x00", index)
        value = data[index:end].decode("utf-8", "replace")
        index = end + 1
        return value

    def read_map() -> dict:
        nonlocal index
        result = {}
        while index < len(data):
            marker = data[index]
            index += 1
            if marker == VDF_END:
                return result

            key = read_string()
            if marker == VDF_MAP:
                result[key] = read_map()
            elif marker == VDF_STRING:
                result[key] = read_string()
            elif marker == VDF_INT32:
                result[key] = int.from_bytes(data[index:index + 4], "little", signed=True)
                index += 4
            else:
                raise ValueError(f"Unexpected VDF marker {marker:#04x} at byte {index - 1}")
        return result

    return read_map()


def _build_ssl_context() -> ssl.SSLContext:
    """A verifying SSL context that works inside the plugin sandbox."""
    if get_ssl_context is not None:
        return get_ssl_context()

    # Outside the loader, certifi is still the bundle worth trusting if it is
    # installed; otherwise the system store, which is right on a desktop.
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


_SSL_CONTEXT: ssl.SSLContext | None = None


def _ssl_context() -> ssl.SSLContext:
    """The shared SSL context. Built once: it reads a CA bundle off disk."""
    global _SSL_CONTEXT
    if _SSL_CONTEXT is None:
        _SSL_CONTEXT = _build_ssl_context()
    return _SSL_CONTEXT


def _explain_url_error(reason: object) -> str:
    """Turn a URLError reason into something a user can act on."""
    detail = str(reason)
    if "CERTIFICATE_VERIFY_FAILED" in detail:
        return (
            "could not verify the certificate — check the Deck's date and time, "
            "since a wrong clock invalidates every certificate"
        )
    return detail


def _sgdb_request(key: str, path: str, params: dict | None = None) -> list:
    """GET a SteamGridDB endpoint whose `data` is a list."""
    data = _sgdb_get(key, path, params)
    return data if isinstance(data, list) else []


def _sgdb_get(key: str, path: str, params: dict | None = None) -> object:
    """
    GET a SteamGridDB endpoint and return its `data`.

    Raises `RuntimeError` with a message meant for the panel — everything here
    fails for reasons the user can act on (wrong key, no network), so a stack
    trace in the log is not the useful part.

    A 404 is not an error: the asset endpoints answer that way for a game that
    simply has no artwork of that kind.
    """
    url = f"{SGDB_API}/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)

    request = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {key}",
        "User-Agent": f"shortcut-forge/{PLUGIN_VERSION}",
    })

    try:
        with urllib.request.urlopen(request, timeout=SGDB_TIMEOUT, context=_ssl_context()) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return []
        if error.code in (401, 403):
            raise RuntimeError("SteamGridDB rejected the API key") from error
        if error.code == 429:
            raise RuntimeError("SteamGridDB is rate-limiting this key; try again later") from error
        raise RuntimeError(f"SteamGridDB returned HTTP {error.code}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(
            f"Could not reach SteamGridDB ({_explain_url_error(error.reason)})",
        ) from error
    except (ValueError, OSError) as error:
        raise RuntimeError(f"SteamGridDB sent an unreadable response ({error})") from error

    if not isinstance(payload, dict) or not payload.get("success"):
        errors = payload.get("errors") if isinstance(payload, dict) else None
        detail = ", ".join(str(item) for item in errors) if errors else "unknown error"
        raise RuntimeError(f"SteamGridDB said: {detail}")

    return payload.get("data")


def _best_match(games: list, name: str) -> dict | None:
    """
    Pick the game a search meant.

    SteamGridDB orders autocomplete results by relevance, so the first result is
    normally right — but an exact title match further down the list is a better
    answer than a fuzzy one at the top.
    """
    candidates = [
        game for game in games
        if isinstance(game, dict) and isinstance(game.get("id"), int) and game.get("name")
    ]
    if not candidates:
        return None

    wanted = name.strip().lower()
    return next(
        (game for game in candidates if str(game["name"]).strip().lower() == wanted),
        candidates[0],
    )


def _download_artwork(url: str) -> bytes:
    """Fetch one artwork file, refusing anything that is not a plain web download."""
    if urllib.parse.urlparse(url).scheme not in ("http", "https"):
        raise RuntimeError(f"Refusing to download {url}")

    request = urllib.request.Request(url, headers={
        "User-Agent": f"shortcut-forge/{PLUGIN_VERSION}",
    })

    try:
        with urllib.request.urlopen(request, timeout=SGDB_TIMEOUT, context=_ssl_context()) as response:
            # One byte past the cap, so an oversized file is detected rather
            # than silently truncated.
            data = response.read(MAX_ARTWORK_BYTES + 1)
    # HTTPError is a URLError, so it has to be caught first or its status code
    # is reported as the bare reason phrase.
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Download failed (HTTP {error.code})") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Download failed ({_explain_url_error(error.reason)})") from error
    except OSError as error:  # socket and file errors
        raise RuntimeError(f"Download failed ({error})") from error

    if not data:
        raise RuntimeError("Download was empty")
    if len(data) > MAX_ARTWORK_BYTES:
        raise RuntimeError(f"Artwork is larger than {MAX_ARTWORK_BYTES // (1024 * 1024)} MB")
    return data


def _write_artwork(directory: str, app_id: int, suffix: str, asset: dict) -> str:
    """
    Download one asset into Steam's grid folder and return where it landed.

    Written to a temporary name and moved into place, so Steam can never read a
    half-downloaded image.
    """
    url = asset.get("url")
    if not isinstance(url, str) or not url:
        raise RuntimeError("SteamGridDB returned an asset with no URL")

    extension = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
    if extension not in ARTWORK_EXTENSIONS:
        extension = ".png"

    data = _download_artwork(url)
    target = os.path.join(directory, f"{app_id}{suffix}{extension}")
    partial = f"{target}.part"

    with open(partial, "wb") as handle:
        handle.write(data)
    os.replace(partial, target)

    for other in ARTWORK_EXTENSIONS:
        if other == extension:
            continue
        try:
            os.remove(os.path.join(directory, f"{app_id}{suffix}{other}"))
        except OSError:
            pass

    return target


# What can be launched by name alone. A file with no extension still counts if
# it has the executable bit, which is how most native Linux games ship.
LAUNCHABLE_EXTENSIONS = WINDOWS_EXTENSIONS | {".sh", ".appimage", ".x86_64", ".x86", ".bin", ".run"}

# Launchable, but never the game: crash reporters, uninstallers and redistributables.
HELPER_FILES = re.compile(
    r"^(unins\d*|uninstall.*|.*crash.?(handler|report|pad).*|vc_?redist.*|dx(web)?setup.*"
    r"|directx.*|oalinst.*|dotnet.*|ndp\d+.*|physx.*|ue[345]prereq.*|.*prereq.*setup.*"
    r"|easyanticheat.*|battleye.*)(\.[a-z0-9_]+)?$",
    re.IGNORECASE,
)

# More entries than anyone could browse with a D-pad, and enough to slow the panel.
MAX_DIRECTORY_ENTRIES = 2000


def _squash(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _pick_best_match(entries: list, folder_name: str) -> str:
    """The file most likely to be the game: named after its folder, else the largest."""
    candidates = [entry for entry in entries if entry["launchable"] and not entry["helper"]]
    if not candidates:
        return ""
    folder = _squash(folder_name)

    def score(entry: dict) -> tuple:
        stem = _squash(os.path.splitext(entry["name"])[0])
        matches = 2 if stem == folder else 1 if stem and (stem in folder or folder in stem) else 0
        return (matches, entry["size"])

    return max(candidates, key=score)["path"]


def _list_directory(path: str, show_hidden: bool) -> dict:
    """One folder for the panel's file browser, folders first and in natural order."""
    path = os.path.abspath(path)
    parent = os.path.dirname(path)
    result = {
        "path": path,
        "parent": "" if parent == path else parent,
        "entries": [],
        "best_match": "",
        "truncated": False,
        "error": "",
    }

    entries = []
    try:
        with os.scandir(path) as iterator:
            for item in iterator:
                if item.name.startswith(".") and not show_hidden:
                    continue
                if len(entries) >= MAX_DIRECTORY_ENTRIES:
                    result["truncated"] = True
                    break
                try:
                    is_dir = item.is_dir()
                    size = 0 if is_dir else item.stat().st_size
                except OSError:
                    continue  # a broken symlink, or one we may not follow
                extension = os.path.splitext(item.name)[1].lower()
                executable = not is_dir and os.access(item.path, os.X_OK)
                launchable = not is_dir and (
                    extension in LAUNCHABLE_EXTENSIONS or (not extension and executable)
                )
                entries.append({
                    "name": item.name,
                    "path": item.path,
                    "is_dir": is_dir,
                    "size": size,
                    "launchable": launchable,
                    "is_windows_app": extension in WINDOWS_EXTENSIONS,
                    "helper": launchable and bool(HELPER_FILES.match(item.name)),
                })
    except OSError as error:
        result["error"] = error.strerror or str(error)
        return result

    def natural(entry: dict) -> list:
        return [
            (0, int(part)) if part.isdigit() else (1, part.lower())
            for part in re.split(r"(\d+)", entry["name"])
        ]

    entries.sort(key=lambda entry: (not entry["is_dir"], natural(entry)))
    result["entries"] = entries
    result["best_match"] = _pick_best_match(entries, os.path.basename(path))
    return result


# Where Steam serves a game's store artwork. The file names below it carry a
# content hash, so the old fixed paths like library_hero.jpg 404 for newer games.
STEAM_ASSET_BASE = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps"

# Library art slot -> the field of SteamGridDB's Steam metadata that describes the
# game's own file for it. SteamGridDB has no "official" style for grids or heroes
# (it answers "Invalid style"), so this is the only route to the real ones.
OFFICIAL_ART_FIELDS = {
    "grid": "library_capsule_full",
    "wide grid": "header_image_full",
    "hero": "library_hero_full",
    "logo": "library_logo_full",
}

# SteamGridDB does label these two kinds, so "official" can simply be asked for.
OFFICIAL_STYLE_ENDPOINTS = ("logos", "icons")


def _pick_language(files: object) -> str:
    """English when there is one, since that is what a shortcut's title is searched in."""
    if not isinstance(files, dict) or not files:
        return ""
    chosen = files.get("english") or next(iter(files.values()))
    return chosen if isinstance(chosen, str) else ""


def _official_art(steam_entry: dict) -> dict:
    """
    The game's own Steam artwork, from SteamGridDB's record of its Steam page.

    Returns the URL for each slot Steam has a file for, plus where the logo goes.
    Anything missing is simply left out, and that slot falls back to SteamGridDB.
    """
    steam_id = str(steam_entry.get("id") or "")
    metadata = steam_entry.get("metadata")
    if not steam_id.isdigit() or not isinstance(metadata, dict):
        return {}

    urls = {}
    for slot, field in OFFICIAL_ART_FIELDS.items():
        block = metadata.get(field)
        if not isinstance(block, dict):
            continue
        # The header is a plain language map; the others offer a double-size image.
        sized = block.get("image2x") or block.get("image")
        path = _pick_language(sized if sized else block)
        if path:
            urls[slot] = f"{STEAM_ASSET_BASE}/{steam_id}/{path}"

    art = {"urls": urls, "logo_position": None}
    try:
        position = json.loads(metadata.get("logo_position") or "null")
        if isinstance(position, dict):
            art["logo_position"] = {
                "pinnedPosition": str(position["pinned_position"]),
                "nWidthPct": float(position["width_pct"]),
                "nHeightPct": float(position["height_pct"]),
            }
    except (KeyError, TypeError, ValueError):
        pass  # Steam's default placement is fine
    return art


def _parse_version(text: object) -> tuple | None:
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", text.strip()) if isinstance(text, str) else None
    return tuple(int(part) for part in match.groups()) if match else None


def _no_update(**fields) -> dict:
    return {"available": False, "version": "", "artifact": "", "hash": "", "notes": "", "error": "", **fields}


def _read_release(release: object, current: str) -> dict:
    """What a GitHub release means for this install. Anything odd is simply not an update."""
    if not isinstance(release, dict):
        return _no_update(error="GitHub sent an unexpected answer")

    version = _parse_version(release.get("tag_name"))
    installed = _parse_version(current)
    if not version or not installed:
        return _no_update(error="Could not read the version numbers")
    if version <= installed:
        return _no_update()

    assets = release.get("assets")
    for asset in assets if isinstance(assets, list) else []:
        url = asset.get("browser_download_url") if isinstance(asset, dict) else None
        # Only ever from this project's own releases, whatever the answer says.
        if not isinstance(url, str) or not url.startswith(RELEASES_DOWNLOAD) or not url.endswith(".zip"):
            continue
        digest = asset.get("digest")
        checksum = digest[len("sha256:"):] if isinstance(digest, str) and digest.startswith("sha256:") else ""
        # Decky checks the download against this before installing it.
        if not re.fullmatch(r"[0-9a-f]{64}", checksum):
            return _no_update(error="The release has no checksum, so it was not offered")
        notes = release.get("body")
        return {
            **_no_update(),
            "available": True,
            "version": ".".join(str(part) for part in version),
            "artifact": url,
            "hash": checksum,
            "notes": notes.strip()[:600] if isinstance(notes, str) else "",
        }
    return _no_update(error="The release has no plugin zip")


def _fetch_latest_release() -> object:
    request = urllib.request.Request(RELEASES_API, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": f"shortcut-forge/{PLUGIN_VERSION}",
    })
    with urllib.request.urlopen(request, timeout=UPDATE_CHECK_TIMEOUT, context=_ssl_context()) as response:
        return json.load(response)


def _clean_custom_presets(presets) -> list:
    """Only well-formed presets get stored, since the panel trusts what it reads back."""
    cleaned = []
    seen = set()
    for preset in presets if isinstance(presets, list) else []:
        if not isinstance(preset, dict):
            continue
        preset_id = preset.get("id")
        alias = preset.get("alias")
        options = preset.get("options")
        if not all(isinstance(value, str) for value in (preset_id, alias, options)):
            continue
        preset_id, alias, options = preset_id.strip(), alias.strip(), options.strip()
        if not preset_id or not alias or not options or preset_id in seen:
            continue
        if len(alias) > CUSTOM_PRESET_MAX_ALIAS or len(options) > CUSTOM_PRESET_MAX_OPTIONS:
            continue
        seen.add(preset_id)
        cleaned.append({"id": preset_id, "alias": alias, "options": options})
    return cleaned[:CUSTOM_PRESET_MAX_COUNT]


def _no_game(message: str) -> dict:
    """A failed artwork search, in the shape `find_artwork` promises."""
    return {"found": False, "game_id": 0, "game_name": "", "error": message}


class Plugin:
    async def _main(self):
        self.settings_path = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, SETTINGS_FILENAME)
        self.settings = self._read_settings()
        # SteamGridDB game id -> its official Steam art, looked up once per add.
        self._official_art: dict = {}
        self._update_result: dict | None = None
        self._update_checked = 0.0
        decky.logger.info("Shortcut Forge ready")

    async def _unload(self):
        decky.logger.info("Shortcut Forge unloaded")

    async def _uninstall(self):
        decky.logger.info("Shortcut Forge uninstalled")

    # --- Browsing --------------------------------------------------------

    async def get_start_path(self) -> str:
        """Directory the file picker should open at."""
        remembered = self.settings.get("last_directory")
        if remembered and os.path.isdir(remembered):
            return remembered
        return decky.HOME

    async def remember_directory(self, path: str) -> None:
        """Persist the directory of the last picked file so the picker reopens there."""
        directory = path if os.path.isdir(path) else os.path.dirname(path)
        if not directory:
            return
        self.settings["last_directory"] = directory
        self._write_settings()

    async def get_default_folder(self) -> str:
        """Where new entries open, or "" when unset or not there right now, like an SD card."""
        folder = self.settings.get("default_folder")
        return folder if isinstance(folder, str) and os.path.isdir(folder) else ""

    async def set_default_folder(self, path: str) -> str:
        """Pass "" to clear it. Resolves with what is now the default."""
        folder = os.path.abspath(path) if path else ""
        if folder and not os.path.isdir(folder):
            return await self.get_default_folder()
        self.settings["default_folder"] = folder
        self._write_settings()
        decky.logger.info("Default folder %s", folder or "cleared")
        return folder

    async def list_locations(self) -> dict:
        """The sidebar: recent folder, home and user directories, and mounted drives."""
        recent = self.settings.get("last_directory")
        return {
            "recent": (
                {"label": os.path.basename(recent) or recent, "path": recent, "kind": "recent",
                 "detail": recent}
                if recent and os.path.isdir(recent)
                else None
            ),
            "places": self._list_places(),
            "drives": self._list_drives(),
        }

    async def list_directory(self, path: str, show_hidden: bool = False) -> dict:
        """One folder for the file browser. A read failure comes back as `error`."""
        return await asyncio.to_thread(_list_directory, path, show_hidden)


    # --- Picked file -----------------------------------------------------

    async def inspect_path(self, path: str) -> dict:
        """Describe a picked path so the frontend can pre-fill the form and warn early."""
        exists = os.path.exists(path)
        is_dir = os.path.isdir(path)
        extension = os.path.splitext(path)[1].lower()

        return {
            "path": path,
            "exists": exists,
            "is_dir": is_dir,
            "directory": path if is_dir else os.path.dirname(path),
            "extension": extension,
            "is_windows_app": extension in WINDOWS_EXTENSIONS,
            "is_executable": exists and not is_dir and os.access(path, os.X_OK),
            "looks_launchable": extension not in NON_EXECUTABLE_EXTENSIONS,
            "needs_quoting": bool(path) and shlex.quote(path) != path,
        }

    async def make_executable(self, path: str) -> dict:
        """Add the executable bit to a file, e.g. a freshly downloaded .sh or AppImage."""
        if not os.path.isfile(path):
            return {"success": False, "error": "File does not exist"}

        try:
            mode = os.stat(path).st_mode
            os.chmod(path, mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        except OSError as error:
            decky.logger.error("Could not make %s executable: %s", path, error)
            return {"success": False, "error": str(error)}

        # Filesystems mounted noexec (some SD card / NTFS setups) silently drop
        # the bit, so report what actually stuck rather than what we asked for.
        if not os.access(path, os.X_OK):
            return {
                "success": False,
                "error": "The filesystem does not allow executable files (mounted noexec?)",
            }

        decky.logger.info("Made %s executable", path)
        return {"success": True}

    # --- Preferences -----------------------------------------------------

    async def get_restart_preference(self) -> str:
        # Current clients save a new shortcut within seconds, so a restart only
        # makes its icon appear and is not worth interrupting anyone for.
        value = self.settings.get("restart_after_add", "never")
        return value if value in RESTART_CHOICES else "never"

    async def set_restart_preference(self, value: str) -> None:
        if value not in RESTART_CHOICES:
            decky.logger.warning("Ignoring unknown restart preference %r", value)
            return
        self.settings["restart_after_add"] = value
        self._write_settings()
        decky.logger.info("Restart preference set to %s", value)

    # --- Artwork ---------------------------------------------------------

    async def get_update_check_enabled(self) -> bool:
        return self.settings.get("check_for_updates", True) is not False

    async def set_update_check_enabled(self, value: bool) -> None:
        self.settings["check_for_updates"] = bool(value)
        self._write_settings()

    async def check_for_update(self, force: bool = False) -> dict:
        """
        Whether GitHub has a newer release. Never raises: not being able to tell is
        no reason to bother anyone, so a failure only shows when asked directly.
        """
        if not force and self.settings.get("check_for_updates", True) is False:
            return _no_update()
        now = time.monotonic()
        if not force and self._update_result and now - self._update_checked < UPDATE_CHECK_SECONDS:
            return self._update_result
        try:
            release = await asyncio.to_thread(_fetch_latest_release)
            result = _read_release(release, PLUGIN_VERSION)
        except urllib.error.HTTPError as error:
            result = _no_update(error=f"GitHub returned HTTP {error.code}")
        except urllib.error.URLError as error:
            result = _no_update(error=f"Could not reach GitHub ({_explain_url_error(error.reason)})")
        except (OSError, ValueError) as error:
            result = _no_update(error=f"Could not read GitHub's answer ({error})")
        self._update_result = result
        self._update_checked = now
        decky.logger.info("Update check: %s", result["version"] or result["error"] or "up to date")
        return result

    async def get_custom_presets(self) -> list:
        return _clean_custom_presets(self.settings.get("custom_presets"))

    async def set_custom_presets(self, presets: list) -> list:
        self.settings["custom_presets"] = _clean_custom_presets(presets)
        self._write_settings()
        decky.logger.info("Saved %d custom launch presets", len(self.settings["custom_presets"]))
        return self.settings["custom_presets"]

    async def get_artwork_settings(self) -> dict:
        """Whether artwork is wanted, the key it needs, and the slots it fills."""
        return {
            "enabled": self.settings.get("download_artwork", True) is not False,
            "key": str(self.settings.get("steamgriddb_key") or ""),
            "key_url": SGDB_KEY_URL,
            # Handed to the frontend so it can count its own progress rather
            # than keeping a second copy of this list.
            "slots": [label for label, *_ in ARTWORK_KINDS],
        }

    async def set_artwork_enabled(self, value: bool) -> None:
        self.settings["download_artwork"] = bool(value)
        self._write_settings()
        decky.logger.info("Artwork download %s", "enabled" if value else "disabled")

    async def set_steamgriddb_key(self, value: str) -> None:
        self.settings["steamgriddb_key"] = (value or "").strip()
        self._write_settings()
        # Never log the key itself; the plugin log is what users attach to reports.
        decky.logger.info("SteamGridDB key %s", "saved" if self.settings["steamgriddb_key"] else "cleared")

    async def find_artwork(self, search_name: str) -> dict:
        """
        Find the game SteamGridDB will be asked for artwork.

        Split from the downloads so the panel can show real progress: one search,
        then one call per artwork slot. Everything that can go wrong is reported
        rather than raised — the shortcut already exists by the time any of this
        runs, and missing artwork must never read as a failed add.
        """
        key = str(self.settings.get("steamgriddb_key") or "").strip()
        if not key:
            return _no_game(f"No SteamGridDB API key. Get one at {SGDB_KEY_URL}.")

        name = (search_name or "").strip()
        if not name:
            return _no_game("No name to search SteamGridDB for")

        try:
            # Blocking, and this runs on the loader's event loop.
            games = await asyncio.to_thread(
                _sgdb_request, key, "search/autocomplete/" + urllib.parse.quote(name, safe=""),
            )
        except RuntimeError as error:
            decky.logger.warning('Artwork search for "%s" failed: %s', name, error)
            return _no_game(str(error))
        except (OSError, ValueError) as error:
            decky.logger.exception('Artwork search for "%s" failed', name)
            return _no_game(str(error))

        game = _best_match(games, name)
        if not game:
            return _no_game(f'SteamGridDB has no game called "{name}"')

        decky.logger.info('Artwork search for "%s" matched %s (%s)', name, game["name"], game["id"])
        return {"found": True, "game_id": int(game["id"]), "game_name": str(game["name"]), "error": ""}

    async def preview_artwork(self, search_name: str) -> dict:
        """What an add would apply for this title, as URLs the panel can show directly."""
        match = await self.find_artwork(search_name)
        if not match["found"]:
            return {**match, "official": False, "images": {}}
        key = str(self.settings.get("steamgriddb_key") or "").strip()
        images, official = await asyncio.to_thread(self._preview_images, match["game_id"], key)
        return {**match, "official": official, "images": images}

    def _preview_images(self, game_id: int, key: str) -> tuple:
        """Follows the same order as `_fetch_slot`, so the preview is what gets applied."""
        official_urls = self._official_art_for(game_id, key).get("urls", {})
        images = {}
        for label, endpoint, _suffix, dimensions, _asset_type in ARTWORK_KINDS:
            if label == "wide grid":
                continue
            if official_urls.get(label):
                images[label] = official_urls[label]
                continue
            params = {"types": "static"}
            if dimensions:
                params["dimensions"] = dimensions
            try:
                assets = []
                if endpoint in OFFICIAL_STYLE_ENDPOINTS:
                    assets = _sgdb_request(key, f"{endpoint}/game/{game_id}", {**params, "styles": "official"})
                if not assets:
                    assets = _sgdb_request(key, f"{endpoint}/game/{game_id}", params)
            except RuntimeError as error:
                decky.logger.warning("No %s preview: %s", label, error)
                continue
            url = assets[0].get("thumb") or assets[0].get("url") if assets else ""
            if isinstance(url, str) and url:
                images[label] = url
        return images, bool(official_urls)

    async def download_artwork_slot(self, app_id: int, game_id: int, slot: str) -> dict:
        """
        Fetch one kind of artwork, for the frontend to hand to Steam.

        Library art is *not* written to the grid folder here. Steam owns that
        folder, and dropping files into it only takes effect at the next startup
        if it takes effect at all; `SteamClient.Apps.SetCustomArtworkForApp` is
        how Game Mode applies art, and it shows up immediately. So this returns
        the image itself, base64-encoded, along with the asset type to apply it
        as. The icon is the one slot Steam takes as a file path, so that one is
        still written here.
        """
        empty = {"data": "", "extension": "", "asset_type": -1, "icon_path": "", "error": ""}

        kind = next((entry for entry in ARTWORK_KINDS if entry[0] == slot), None)
        if not kind:
            return {**empty, "error": f"unknown artwork kind {slot!r}"}

        key = str(self.settings.get("steamgriddb_key") or "").strip()
        if not key:
            return {**empty, "error": "artwork is not configured"}

        try:
            return await asyncio.to_thread(self._fetch_slot, int(app_id), int(game_id), kind, key)
        except (RuntimeError, OSError, ValueError) as error:
            decky.logger.warning("No %s for appid %s: %s", slot, app_id, error)
            return {**empty, "error": str(error)}

    def _fetch_slot(self, app_id: int, game_id: int, kind: tuple, key: str) -> dict:
        label, endpoint, suffix, dimensions, asset_type = kind
        empty = {"data": "", "extension": "", "asset_type": asset_type, "icon_path": "", "error": ""}

        # The game's real Steam art comes first. Failing to get it only ever means
        # falling back to what the community uploaded.
        official = self._official_art_for(game_id, key)
        official_url = official.get("urls", {}).get(label)
        if official_url:
            try:
                data = _download_artwork(official_url)
            except RuntimeError as error:
                decky.logger.warning("Official %s unavailable: %s", label, error)
            else:
                decky.logger.info(
                    "Fetched official %s for appid %s from %s (%d KB)",
                    label, app_id, official_url, len(data) // 1024,
                )
                return {
                    **empty,
                    "data": base64.b64encode(data).decode("ascii"),
                    "extension": "png",
                    "logo_position": official.get("logo_position") if label == "logo" else None,
                }

        # Animated assets exist for some games; Steam does not display them for
        # shortcuts, so they are filtered out rather than downloaded.
        params = {"types": "static"}
        if dimensions:
            params["dimensions"] = dimensions

        assets = []
        if endpoint in OFFICIAL_STYLE_ENDPOINTS:
            assets = _sgdb_request(key, f"{endpoint}/game/{game_id}", {**params, "styles": "official"})
        if not assets:
            assets = _sgdb_request(key, f"{endpoint}/game/{game_id}", params)
        if not assets:
            return {**empty, "error": "none available"}

        url = assets[0].get("url")
        if not isinstance(url, str) or not url:
            return {**empty, "error": "SteamGridDB returned an asset with no URL"}

        # Steam takes a non-Steam game's icon from the shortcut itself, as a
        # path, so this one has to exist on disk.
        if asset_type == ASSET_ICON:
            directory = self._artwork_dir()
            if not directory:
                return {**empty, "error": "could not find Steam's userdata folder"}
            os.makedirs(directory, exist_ok=True)
            written = _write_artwork(directory, app_id, suffix, assets[0])
            decky.logger.info("Wrote %s for appid %s to %s", label, app_id, written)
            return {**empty, "icon_path": written}

        data = _download_artwork(url)
        decky.logger.info(
            "Fetched %s for appid %s from %s (%d KB)", label, app_id, url, len(data) // 1024,
        )
        return {
            **empty,
            "data": base64.b64encode(data).decode("ascii"),
            # Always "png", whatever the asset really is. Steam accepts only
            # "png" or "jpg" here and uses it for the filename it writes, not to
            # decode with — the renderer sniffs the actual format. This is what
            # SteamGridDB's own plugin passes for every asset it applies.
            "extension": "png",
        }

    def _official_art_for(self, game_id: int, key: str) -> dict:
        """The game's Steam art, or {} when it has no Steam page or the lookup fails."""
        if game_id not in self._official_art:
            art = {}
            try:
                game = _sgdb_get(key, f"games/id/{game_id}", {"platformdata": "steam"})
                entries = game.get("external_platform_data", {}).get("steam") if isinstance(game, dict) else None
                if entries:
                    art = _official_art(entries[0])
            except (RuntimeError, AttributeError, TypeError) as error:
                decky.logger.warning("Could not look up official art: %s", error)
            self._official_art[game_id] = art
        return self._official_art[game_id]

    async def list_artwork(self, app_id: int) -> dict:
        """
        The artwork files on disk for one shortcut.

        Steam writes these itself when it accepts art through
        `SetCustomArtworkForApp`, so reading them back is how the panel can say
        the art landed rather than just that it was sent.
        """
        directory = self._artwork_dir()
        if not directory:
            return {"directory": "", "files": [], "error": "Steam userdata folder not found"}

        # Matched against the exact names this plugin writes rather than by
        # prefix: one appid is a prefix of another often enough to matter.
        wanted = {f"{int(app_id)}{kind[2]}" for kind in ARTWORK_KINDS}
        try:
            names = sorted(
                name for name in os.listdir(directory)
                if os.path.splitext(name)[0] in wanted
            )
        except OSError as error:
            return {"directory": directory, "files": [], "error": str(error)}

        return {"directory": directory, "files": names, "error": ""}

    async def check_steamgriddb(self) -> dict:
        """
        Whether the saved key works, by actually calling SteamGridDB.

        The panel runs this after every save. A key that was mistyped, truncated
        by a partial paste, or never written to disk is indistinguishable from a
        working one until something asks the API — and if that something is the
        next add, the answer arrives far away from the field that caused it.
        """
        key = str(self.settings.get("steamgriddb_key") or "").strip()
        if not key:
            return {"ok": False, "detail": "no API key is saved"}

        try:
            await asyncio.to_thread(_sgdb_request, key, "search/autocomplete/portal")
        except RuntimeError as error:
            return {"ok": False, "detail": str(error)}
        return {"ok": True, "detail": "key accepted"}

    def _artwork_dir(self) -> str | None:
        """
        `userdata/<account>/config/grid`, where Steam reads custom artwork from.

        A Deck can hold more than one Steam account, so the account that logged
        in last wins — that is the library the user is looking at.
        """
        accounts: dict = {}
        for root in self._userdata_roots():
            try:
                entries = sorted(os.listdir(root))
            except OSError:
                continue
            for entry in entries:
                path = os.path.join(root, entry)
                # "0" is the folder Steam uses when nobody is logged in.
                if entry.isdigit() and entry != "0" and os.path.isdir(path):
                    accounts.setdefault(os.path.realpath(path), path)

        if not accounts:
            return None

        recent = self._most_recent_account()
        chosen = next(
            (path for path in accounts.values() if os.path.basename(path) == recent),
            None,
        ) or max(accounts.values(), key=self._mtime)
        return os.path.join(chosen, "config", "grid")

    def _most_recent_account(self) -> str | None:
        """Account id of the last Steam account to log in, per loginusers.vdf."""
        for root in (os.path.join(".steam", "steam"), os.path.join(".local", "share", "Steam")):
            path = os.path.join(decky.HOME, root, "config", "loginusers.vdf")
            current = None
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as handle:
                    for line in handle:
                        heading = LOGIN_USER_ID.match(line)
                        if heading:
                            current = heading.group(1)
                        elif current and LOGIN_USER_MOST_RECENT.match(line):
                            return str(int(current) - STEAM_ID64_BASE)
            except OSError:
                continue
        return None

    def _mtime(self, path: str) -> float:
        try:
            return os.path.getmtime(path)
        except OSError:
            return 0.0

    # --- Diagnostics -----------------------------------------------------

    async def ping(self) -> str:
        """Proves the Python backend loaded, and reports which build is running."""
        return PLUGIN_VERSION

    async def log(self, level: str, message: str) -> None:
        """Mirror frontend events into the plugin log, which is what users can send us."""
        getattr(decky.logger, level, decky.logger.info)(message)

    async def list_saved_shortcuts(self) -> dict:
        """
        The non-Steam games Steam has actually written to disk.

        Steam keeps its shortcut list in memory and only writes `shortcuts.vdf`
        during a clean shutdown, so this is the ground truth for "will my game
        still be there tomorrow" — and the answer only changes after a restart.
        """
        files = self._shortcut_files()
        if not files:
            return {"found": False, "shortcuts": [], "error": "No shortcuts.vdf yet"}

        shortcuts = []
        for path in files:
            try:
                with open(path, "rb") as handle:
                    parsed = _parse_binary_vdf(handle.read())
            except (OSError, ValueError) as error:
                decky.logger.warning("Could not read %s: %s", path, error)
                continue

            for entry in parsed.get("shortcuts", {}).values():
                if not isinstance(entry, dict):
                    continue
                shortcuts.append({
                    # Steam stores the id as a signed int32; the frontend uses
                    # the unsigned form.
                    "app_id": int(entry.get("appid", 0)) & 0xFFFFFFFF,
                    "name": entry.get("AppName") or entry.get("appname") or "",
                    "exe": (entry.get("Exe") or entry.get("exe") or "").strip('"'),
                })

        return {"found": True, "shortcuts": shortcuts}

    def _userdata_roots(self) -> tuple:
        """Both paths Steam's userdata tree is reachable by. Usually the same place."""
        return (
            os.path.join(decky.HOME, ".steam", "steam", "userdata"),
            os.path.join(decky.HOME, ".local", "share", "Steam", "userdata"),
        )

    def _shortcut_files(self) -> list:
        found = []
        for root in self._userdata_roots():
            for path in glob.glob(os.path.join(root, "*", "config", "shortcuts.vdf")):
                resolved = os.path.realpath(path)
                if resolved not in found:
                    found.append(resolved)
        return found



    # --- Internals: places and drives ------------------------------------

    def _list_places(self) -> list:
        home = decky.HOME
        places = [{"label": "Home", "path": home, "kind": "home", "detail": home}]

        user_dirs = self._read_user_dirs()
        seen = {home}
        for key, fallback, kind, label in XDG_PLACES:
            path = user_dirs.get(key) or os.path.join(home, fallback)
            if path not in seen and os.path.isdir(path):
                places.append({"label": label, "path": path, "kind": kind, "detail": path})
                seen.add(path)

        for folder, kind, label in EXTRA_PLACES:
            path = os.path.join(home, folder)
            if path not in seen and os.path.isdir(path):
                places.append({"label": label, "path": path, "kind": kind, "detail": path})
                seen.add(path)

        return places

    def _read_user_dirs(self) -> dict:
        """Parse ~/.config/user-dirs.dirs, which localises Downloads/Documents/..."""
        config = os.path.join(decky.HOME, ".config", "user-dirs.dirs")
        entries = {}
        try:
            with open(config, "r", encoding="utf-8") as handle:
                for line in handle:
                    match = re.match(r'\s*(XDG_[A-Z_]+_DIR)\s*=\s*"(.*)"\s*$', line)
                    if match:
                        key, raw = match.groups()
                        entries[key] = raw.replace("$HOME", decky.HOME)
        except OSError:
            pass
        return entries

    def _list_drives(self) -> list:
        """SD cards, USB sticks and external disks, as mounted by SteamOS."""
        labels = self._device_labels()
        drives = []

        for device, mountpoint, fstype in self._read_mounts():
            if fstype in PSEUDO_FILESYSTEMS or not device.startswith("/dev/"):
                continue
            if not any(mountpoint.startswith(root + "/") for root in REMOVABLE_MOUNT_ROOTS):
                continue
            if not os.path.isdir(mountpoint):
                continue

            label = labels.get(os.path.realpath(device)) or os.path.basename(mountpoint)
            drives.append({
                "label": label,
                "path": mountpoint,
                "kind": "sdcard" if "mmcblk" in device else "drive",
                "detail": mountpoint,
                "free_bytes": self._free_bytes(mountpoint),
                "total_bytes": self._total_bytes(mountpoint),
            })

        drives.sort(key=lambda drive: drive["label"].lower())
        return drives

    def _read_mounts(self) -> list:
        try:
            with open("/proc/mounts", "r", encoding="utf-8") as handle:
                lines = handle.readlines()
        except OSError as error:
            decky.logger.warning("Could not read /proc/mounts: %s", error)
            return []

        mounts = []
        for line in lines:
            fields = line.split()
            if len(fields) < 3:
                continue
            mounts.append((fields[0], _unescape_mount(fields[1]), fields[2]))
        return mounts

    def _device_labels(self) -> dict:
        """Map /dev/sdX -> the filesystem label, so drives get a friendly name."""
        by_label = "/dev/disk/by-label"
        labels = {}
        try:
            for entry in os.listdir(by_label):
                target = os.path.realpath(os.path.join(by_label, entry))
                labels[target] = _unescape_udev(entry)
        except OSError:
            pass
        return labels

    def _free_bytes(self, path: str) -> int:
        try:
            stats = os.statvfs(path)
            return stats.f_bavail * stats.f_frsize
        except OSError:
            return 0

    def _total_bytes(self, path: str) -> int:
        try:
            stats = os.statvfs(path)
            return stats.f_blocks * stats.f_frsize
        except OSError:
            return 0

    def _read_settings(self) -> dict:
        try:
            with open(self.settings_path, "r", encoding="utf-8") as handle:
                loaded = json.load(handle)
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as error:
            decky.logger.warning("Ignoring unreadable settings file: %s", error)
            return {}
        return loaded if isinstance(loaded, dict) else {}

    def _write_settings(self) -> None:
        # Replaced whole, so power loss mid-write cannot cost the API key, and
        # private to the user because it holds that key.
        temporary = f"{self.settings_path}.tmp"
        try:
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(self.settings, handle)
            os.replace(temporary, self.settings_path)
        except OSError as error:
            decky.logger.warning("Could not save settings: %s", error)
