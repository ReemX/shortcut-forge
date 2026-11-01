import assert from "node:assert/strict";
import { applicationTag, matchesQuery, savedShortcutFor, splitApplications, usableIcon } from "../src/applications.ts";
import { LAUNCH_PRESETS, setPreset, setCustomPreset } from "../src/launchPresets.ts";

const app = (name, source, extra = {}) => ({
  name, source, exe: "/usr/bin/" + name.toLowerCase(), args: "", start_dir: "/usr/bin", categories: [],
  icon_path: "", icon_data: "", desktop_file: name + ".desktop", ...extra,
});
const firefox = app("Firefox", "Flatpak", { exe: "/usr/bin/flatpak", args: "run --branch=stable --command=firefox org.mozilla.firefox" });
const one = app("1Password", "Flatpak", { exe: "/usr/bin/flatpak", args: "run --branch=stable --command=1password com.onepassword.OnePassword" });
const konsole = app("Konsole", "System");
const sysGame = app("Sol", "System", { categories: ["Game"] });

// Yours first: anything not from the system, and games from anywhere.
const { own, system } = splitApplications([firefox, konsole, sysGame, one]);
assert.deepEqual(own.map((a) => a.name), ["Firefox", "Sol", "1Password"]);
assert.deepEqual(system.map((a) => a.name), ["Konsole"]);

// Search needs every word, in any order and field.
assert.ok(matchesQuery(firefox, "FIRE"));
assert.ok(matchesQuery(firefox, "flatpak mozilla"));
assert.ok(!matchesQuery(firefox, "fire chrome"));
assert.ok(matchesQuery(konsole, "  "));

// Every Flatpak shares an executable, so only the arguments can tell them apart.
const saved = [{ app_id: 1, name: "Renamed Fox", exe: "/usr/bin/flatpak", launch_options: firefox.args }];
assert.equal(savedShortcutFor(firefox, saved)?.name, "Renamed Fox");
assert.equal(savedShortcutFor(one, saved), undefined);
assert.equal(savedShortcutFor(konsole, [{ app_id: 2, name: "K", exe: "/usr/bin/konsole", launch_options: "" }])?.name, "K");

assert.equal(usableIcon(app("A", "User", { icon_path: "/i/a.svg" })), "");
assert.equal(usableIcon(app("A", "User", { icon_path: "/i/a.png" })), "/i/a.png");

assert.equal(applicationTag(firefox, true), "In library");
assert.equal(applicationTag(firefox, false), "Flatpak");
assert.equal(applicationTag(konsole, false), undefined);

// Presets have to work around an application's own arguments and give them back.
const preset = LAUNCH_PRESETS.find((p) => p.env);
const on = setPreset(preset, firefox.args, true);
assert.ok(on.startsWith(preset.env + " %command% run --branch=stable"), on);
assert.equal(setPreset(preset, on, false), "%command% " + firefox.args);

const quoted = "-c 'curl -fsSL https://example.com/a | bash'";
const custom = { id: "c", alias: "C", options: "gamemoderun %command%" };
const wrapped = setCustomPreset(custom, quoted, true);
assert.equal(wrapped, "gamemoderun %command% " + quoted);
assert.equal(setCustomPreset(custom, wrapped, false), "%command% " + quoted);

console.log("applications ok");
