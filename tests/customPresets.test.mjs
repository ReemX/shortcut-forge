import assert from "node:assert/strict";
import {
  countActivePresets,
  customPresetProblem,
  isCustomPresetOn,
  setCustomPreset,
} from "../src/launchPresets.ts";

const preset = (options) => ({ id: "x", alias: "x", options });
const on = (text, options = "") => setCustomPreset(preset(text), options, true);
const off = (text, options) => setCustomPreset(preset(text), options, false);
const isOn = (text, options) => isCustomPresetOn(preset(text), options);

// A round trip leaves nothing behind.
for (const text of [
  "FOO=1 %command%",
  "FOO=1 BAR=2 %command% -windowed",
  'WINEDLLOVERRIDES="a,b=n,b" %command%',
  'WINEDLLOVERRIDES="a=n,b;c=d" %command%',
  "gamemoderun %command%",
  "gamescope -w 1280 -- %command%",
  "%command% -windowed -fullscreen 0",
  'FOO="two words" %command%',
]) {
  const applied = on(text);
  assert.ok(isOn(text, applied), `on: ${text}`);
  assert.equal(off(text, applied), "", `off: ${text}`);
}

// Saved exactly as typed, it produces the same launch options.
const dllLine = 'WINEDLLOVERRIDES="a,b,c=n,b" %command%';
assert.equal(on(dllLine), dllLine);

// A variable with no %command% means the variable, not a game argument.
assert.equal(on("FOO=1"), "FOO=1 %command%");
assert.equal(on("FOO=1 -windowed"), "FOO=1 %command% -windowed");
assert.equal(on("-windowed"), "%command% -windowed");

// Merges with what is already there, and leaves it alone on the way out.
assert.equal(on("FOO=1 %command%", "BAR=2 gamemoderun %command% -x"), "BAR=2 FOO=1 gamemoderun %command% -x");
assert.equal(off("FOO=1 %command%", "BAR=2 FOO=1 %command% -x"), "BAR=2 %command% -x");
assert.equal(on("FOO=1", "FOO=0 %command%"), "FOO=1 %command%");
assert.equal(off("FOO=1", "FOO=0 %command%"), "FOO=0 %command%");
assert.equal(
  on('WINEDLLOVERRIDES="a=n,b"', 'WINEDLLOVERRIDES="z=n,b;y=d" %command%'),
  'WINEDLLOVERRIDES="z,a=n,b;y=d" %command%',
);
assert.equal(off('WINEDLLOVERRIDES="a=n,b"', 'WINEDLLOVERRIDES="z,a=n,b" %command%'), 'WINEDLLOVERRIDES="z=n,b" %command%');

// Toggling on twice does not stack.
assert.equal(on("gamemoderun %command% -x", on("gamemoderun %command% -x")), "gamemoderun %command% -x");

// Only on when every part is there, and in order.
assert.ok(!isOn("FOO=1 BAR=2 %command%", "FOO=1 %command%"));
assert.ok(!isOn('WINEDLLOVERRIDES="a,b=n,b"', 'WINEDLLOVERRIDES="a=n,b" %command%'));
assert.ok(!isOn('WINEDLLOVERRIDES="a=d"', 'WINEDLLOVERRIDES="a=n,b" %command%'));
assert.ok(isOn('WINEDLLOVERRIDES="A=n,b"', 'WINEDLLOVERRIDES="a=n,b" %command%'));
assert.ok(!isOn("%command% -a -b", "%command% -b -a"));
assert.ok(isOn("%command% -a -b", "%command% -x -a -b -y"));
assert.ok(!isOn("gamemoderun %command%", "%command% gamemoderun"));
assert.ok(!isOn("%command%", ""));
assert.ok(!isOn("", "FOO=1 %command%"));

// Counted with the built-ins.
assert.equal(countActivePresets("PROTON_LOG=1 FOO=1 %command%", [preset("FOO=1"), { ...preset("BAR=1"), id: "y" }]), 2);

// What the form refuses.
assert.ok(customPresetProblem("", "FOO=1"));
assert.ok(customPresetProblem("  ", "FOO=1"));
assert.ok(customPresetProblem("Name", ""));
assert.ok(customPresetProblem("Name", "%command%"));
assert.ok(customPresetProblem("Name", 'FOO="1 %command%'));
assert.equal(customPresetProblem("Name", "FOO=1"), "");

console.log("custom presets ok");
