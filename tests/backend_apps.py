"""Checks which .desktop files become applications, without a running Decky."""
import os
import sys
import tempfile
import types
import logging
import asyncio

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

decky = types.ModuleType("decky")
decky.logger = logging.getLogger("test")
decky.DECKY_PLUGIN_SETTINGS_DIR = tempfile.mkdtemp()
decky.HOME = decky.DECKY_PLUGIN_SETTINGS_DIR
sys.modules["decky"] = decky

import main  # noqa: E402

root = tempfile.mkdtemp().replace(os.sep, "/")  # Exec lines are shell-quoted, so no backslashes
tool = root + "/tool"
open(tool, "w").close()
user_dir = root + "/user"
flatpak_dir = root + "/flatpak"
os.makedirs(user_dir)
os.makedirs(flatpak_dir)
main.APPLICATION_DIRS = ((user_dir, "User"), (flatpak_dir, "Flatpak"))


def entry(folder, filename, body):
    with open(os.path.join(folder, filename), "w") as handle:
        handle.write("[Desktop Entry]\nType=Application\n" + body + "\n")


entry(user_dir, "tool.desktop", f"Name=My Tool\nExec={tool} %U\nCategories=Game;")
entry(user_dir, "hidden.desktop", f"Name=Hidden\nExec={tool}\nNoDisplay=true")
entry(user_dir, "term.desktop", f"Name=Terminal Thing\nExec={tool}\nTerminal=true")
entry(user_dir, "missing.desktop", "Name=Not Installed\nExec=/does/not/exist")
entry(user_dir, "steamgame.desktop", f"Name=A Steam Game\nExec={tool} steam://rungameid/123")
entry(flatpak_dir, "fp.desktop", f"Name=Flat App\nExec={tool} run --branch=stable @@u %U @@ com.foo.Bar")
# The same desktop ID further down the precedence list loses.
entry(flatpak_dir, "tool.desktop", f"Name=Shadowed\nExec={tool}")

plugin = main.Plugin()
plugin._icon_cache = {}
plugin._applications = None
plugin._applications_stamp = ()

found = plugin._scan_applications()
assert [app["name"] for app in found] == ["Flat App", "My Tool"], found
flat, mine = found
assert flat["exe"] == tool and flat["args"] == "run --branch=stable com.foo.Bar", flat
assert flat["source"] == "Flatpak" and mine["source"] == "User"
assert mine["args"] == "" and mine["categories"] == ["Game"]

# Stays cached until a folder changes, and notices when one does.
first = asyncio.run(plugin.list_applications())
assert len(first) == 2 and asyncio.run(plugin.list_applications()) is first
entry(user_dir, "later.desktop", f"Name=Later\nExec={tool}")
os.utime(user_dir, ns=(1, 1))
assert [app["name"] for app in asyncio.run(plugin.list_applications())] == ["Flat App", "Later", "My Tool"]

print("backend_apps ok")
