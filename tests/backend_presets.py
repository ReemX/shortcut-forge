"""Checks the custom preset storage in main.py without a running Decky."""
import asyncio
import logging
import os
import sys
import tempfile
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

folder = tempfile.mkdtemp()
decky = types.ModuleType("decky")
decky.logger = logging.getLogger("test")
decky.DECKY_PLUGIN_SETTINGS_DIR = folder
decky.DECKY_USER_HOME = folder
decky.HOME = folder
sys.modules["decky"] = decky

helpers = types.ModuleType("helpers")
helpers.get_ssl_context = lambda: None
sys.modules["helpers"] = helpers

import main  # noqa: E402


async def run():
    plugin = main.Plugin()
    await plugin._main()
    assert await plugin.get_custom_presets() == []

    good = {"id": "a", "alias": " One ", "options": " FOO=1 %command% "}
    stored = await plugin.set_custom_presets(
        [
            good,
            {"id": "a", "alias": "duplicate id", "options": "BAR=1"},
            {"id": "b", "alias": "", "options": "BAR=1"},
            {"id": "c", "alias": "no options", "options": "  "},
            {"id": 4, "alias": "bad id", "options": "BAR=1"},
            {"id": "d", "alias": "x" * 81, "options": "BAR=1"},
            {"id": "e", "alias": "long", "options": "x" * 2001},
            "not a preset",
        ]
    )
    assert stored == [{"id": "a", "alias": "One", "options": "FOO=1 %command%"}], stored

    # Survives a restart, and a bad value on disk never reaches the panel.
    reloaded = main.Plugin()
    await reloaded._main()
    assert await reloaded.get_custom_presets() == stored
    reloaded.settings["custom_presets"] = "garbage"
    assert await reloaded.get_custom_presets() == []
    assert await reloaded.set_custom_presets(None) == []


asyncio.run(run())
print("backend presets ok")
