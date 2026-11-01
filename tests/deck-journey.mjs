// Walks the panel on a real Deck with button presses only, and fails if it stops feeling right.
// Needs: ssh -L 18080:127.0.0.1:8080 steamdeck, and a game folder as the first row under Places.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { conn, sleep } from "./deck-cdp-lib.mjs";

setTimeout(() => {
  console.log("TIMEOUT");
  process.exit(3);
}, 180000);
mkdirSync("shots", { recursive: true });

const sh = await conn("SharedJSContext");
const qa = await conn("QuickAccess_uid2");
const BUTTONS = { A: "OK", B: "CANCEL", X: "SECONDARY", UP: "DIR_UP", DOWN: "DIR_DOWN", RIGHT: "DIR_RIGHT" };
const press = async (name, times = 1, gap = 280) => {
  for (let i = 0; i < times; i++) {
    await sh.ev(`(FocusNavController.DispatchVirtualButtonClick(DFL.GamepadButton.${BUTTONS[name]}),'ok')`);
    await sleep(gap);
  }
};
const shot = (name) => {
  execFileSync("ssh", ["steamdeck", `rm -f /tmp/${name}.png; XDG_RUNTIME_DIR=/run/user/1000 GAMESCOPE_WAYLAND_DISPLAY=gamescope-0 gamescopectl screenshot /tmp/${name}.png >/dev/null 2>&1; for i in 1 2 3 4 5 6 7 8 9 10; do [ -s /tmp/${name}.png ] && break; sleep 0.2; done; sleep 0.3`], { timeout: 15000 });
  execFileSync("scp", ["-q", `steamdeck:/tmp/${name}.png`, `shots/${name}.png`], { timeout: 15000 });
};
const state = async () =>
  JSON.parse(
    await qa.ev(`(()=>{
      const a=document.activeElement, r=a?.getBoundingClientRect();
      const box=(e)=>({top:Math.round(e.scrollTop),height:e.scrollHeight,view:e.clientHeight});
      const list=document.querySelector('.sf-scroller');
      const panel=[...document.querySelectorAll('*')].filter(e=>e!==list&&e.scrollHeight>e.clientHeight+2&&/auto|scroll/.test(getComputedStyle(e).overflowY)&&e.clientHeight>200)[0];
      return JSON.stringify({focus:(a?.innerText||a?.tagName||'').trim().split('\\n')[0],gp:!!a?.classList.contains('gpfocus'),y:r&&Math.round(r.top),panel:panel?box(panel):null,list:list?box(list):null});
    })()`),
  );
const focus = async () => (await state()).focus;
const text = async () => String(await qa.ev("document.body.innerText")).replace(/\n+/g, "/");
const backend = (method, ...args) =>
  sh.ev(`DeckyBackend.call('loader/call_plugin_method','Shortcut Forge',${JSON.stringify(method)},...${JSON.stringify(args)}).then(r=>JSON.stringify(r))`);
const downTo = async (label, max = 14) => {
  for (let i = 0; i < max; i++) {
    if ((await focus()).startsWith(label)) return i;
    await press("DOWN");
  }
  throw new Error(`never reached ${label}, stuck on ${await focus()}`);
};
const expectFocus = async (label, why) => {
  const s = await state();
  assert.ok(s.focus.startsWith(label), `${why}: expected focus on ${label}, was ${s.focus}`);
  assert.ok(s.gp, `${why}: ${label} has focus but no highlight`);
  console.log(`ok  ${why}`);
};

const savedDefault = JSON.parse(await backend("get_default_folder"));
await backend("set_default_folder", "");
// A failed run must not leave the Deck's settings changed.
process.on("uncaughtException", async (error) => {
  console.log("FAILED:", error.message);
  await backend("set_default_folder", savedDefault);
  process.exit(1);
});

await sh.ev(`(DFL.Navigation.OpenQuickAccessMenu(DFL.QuickAccessTab.Decky),'ok')`);
await sleep(1500);
for (let i = 0; i < 6 && !(await text()).startsWith("Decky"); i++) await press("B", 1, 700);
await press("RIGHT");
await downTo("Shortcut Forge");
await press("A", 1, 1300);
shot("1-places");

// The first row under Places is the last folder picked from. It may or may not have
// focus yet, depending on whether the panel was already showing Places.
if (!(await state()).gp || (await focus()) === "BUTTON") await press("DOWN");
const folderName = await focus();
console.log("    folder:", folderName);
await press("A", 1, 1000);
assert.ok((await text()).toUpperCase().includes(folderName.toUpperCase()), "A opens the folder");
shot("2-folder");

await press("X", 1, 700);
const folder = JSON.parse(await backend("get_default_folder"));
assert.ok(folder.endsWith(folderName), "X in a folder makes it the default");
console.log("ok  X sets the default folder");

await press("A", 1, 3000);
await expectFocus("Add to Steam", "picking a file lands on Add to Steam");
shot("3-form");
const form = await state();
assert.equal(form.panel.top, 0, "the form starts at the top");

// The whole form is on one screen: moving through it never scrolls.
let toLaunch = 0;
while (!(await focus()).startsWith("Launch options") && toLaunch < 6) {
  await press("DOWN");
  toLaunch++;
  assert.equal((await state()).panel.top, 0, "the form does not scroll");
}
console.log(`ok  form has no scrolling, Launch options is ${toLaunch} presses from Add`);
assert.ok(toLaunch <= 3);

await press("A", 1, 800);
shot("4-launch");
let previous = (await state()).list.top;
const steps = [];
for (let i = 0; i < 12; i++) {
  await press("DOWN", 1, 650);
  const s = await state();
  assert.equal(s.panel.top, 0, "only the list scrolls");
  steps.push(s.list.top - previous);
  previous = s.list.top;
}
console.log("    list moved by", steps.join(", "));
// One row per press once it starts moving, or a row and a heading.
assert.ok(steps.every((step) => step <= 72), "no press moves the list by more than a row and a heading");
assert.ok(steps.slice(2).every((step) => step >= 20), "every press moves the list");
console.log("ok  the list moves evenly");
shot("5-launch-scrolled");

await press("A", 1, 500);
assert.match(await text(), /1 on/, "a toggle counts as on");
await press("A", 1, 500);
assert.doesNotMatch(await text(), /\d on/, "and off again");
console.log("ok  toggling works and leaves nothing behind");

await press("B", 1, 700);
await expectFocus("Launch options", "B returns to the row it came from");
await press("UP", toLaunch);
await expectFocus("Add to Steam", `Add to Steam is ${toLaunch} presses back`);
await press("UP");
await expectFocus("", "the art card takes focus");
const ring = await qa.ev(`getComputedStyle(document.activeElement,'::after').borderTopWidth+' '+getComputedStyle(document.activeElement,'::after').borderTopColor`);
assert.match(ring, /^[1-9][0-9.]*px rgb\(255, 255, 255\)/, "the art card shows it is selected: " + ring);
console.log("ok  the art card shows it is selected");
shot("6a-card-selected");
await press("A", 1, 800);
shot("6-artwork");
await press("B", 1, 700);
await press("DOWN");
await expectFocus("Add to Steam", "and comes back");

await press("B", 1, 800);
assert.ok((await text()).includes("opens here by default"), "B on the form goes back to the folder");
console.log("ok  B on the form goes back to the folder");
await press("B", 1, 800);
assert.ok((await text()).includes("PLACES"), "B in a folder goes to Places");
await expectFocus("", "Places has focus on arrival");
shot("7-places");

await sh.ev(`(DFL.Navigation.CloseSideMenus(),'x')`);
await sleep(1000);
await sh.ev(`(DFL.Navigation.OpenQuickAccessMenu(DFL.QuickAccessTab.Decky),'ok')`);
await sleep(1500);
assert.ok((await text()).includes("opens here by default"), "reopening starts in the default folder");
console.log("ok  reopening starts in the default folder");

await backend("set_default_folder", savedDefault);
console.log("all ok");
process.exit(0);
