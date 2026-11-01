"""Checks how main.py reads a GitHub release, without a running Decky."""
import os
import sys
import tempfile
import types
import logging

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

decky = types.ModuleType("decky")
decky.logger = logging.getLogger("test")
decky.DECKY_PLUGIN_SETTINGS_DIR = tempfile.mkdtemp()
decky.HOME = decky.DECKY_PLUGIN_SETTINGS_DIR
sys.modules["decky"] = decky

import main  # noqa: E402

GOOD_URL = main.RELEASES_DOWNLOAD + "v2.2.0/Shortcut-Forge-v2.2.0.zip"
CHECKSUM = "a" * 64


def release(tag="v2.2.0", url=GOOD_URL, digest="sha256:" + CHECKSUM, body="Notes"):
    return {"tag_name": tag, "body": body, "assets": [{"browser_download_url": url, "digest": digest}]}


found = main._read_release(release(), "2.1.0")
assert found["available"] and found["version"] == "2.2.0" and found["artifact"] == GOOD_URL
assert found["hash"] == CHECKSUM and found["notes"] == "Notes"

# Compared as numbers, not text.
assert main._read_release(release(tag="v2.10.0"), "2.9.0")["available"]
assert main._read_release(release(tag="v3.0.0"), "2.9.9")["available"]

# Same or older is no update, and says nothing.
for tag in ("v2.1.0", "v2.0.9", "2.1.0"):
    result = main._read_release(release(tag=tag), "2.1.0")
    assert not result["available"] and not result["error"], tag

# Never offered: other sources, missing checksums, odd versions, odd answers.
assert not main._read_release(release(url="https://evil.example/x.zip"), "2.1.0")["available"]
assert not main._read_release(release(url="https://github.com/other/repo/releases/download/v9/x.zip"), "2.1.0")["available"]
assert not main._read_release(release(url=main.RELEASES_DOWNLOAD + "v2.2.0/x.exe"), "2.1.0")["available"]
for digest in (None, "", "md5:abc", "sha256:short", "sha256:" + "G" * 64):
    assert not main._read_release(release(digest=digest), "2.1.0")["available"], digest
for bad in (None, [], "text", {}, {"tag_name": "nightly", "assets": []}, {"tag_name": "v9.0.0"}, {"tag_name": "v9.0.0", "assets": ["x"]}):
    result = main._read_release(bad, "2.1.0")
    assert not result["available"] and result["error"], bad
assert main._read_release(release(), "dev")["error"]

print("backend update ok")
