/**
 * Named launch option workarounds, and the editing that turns them on and off.
 *
 * The launch options text stays the single source of truth: a preset is on when
 * its option is in the text, so typing one by hand ticks its toggle and text
 * carried in from an application's run arguments is left alone.
 *
 * Every Proton variable here was checked against the Proton 11 script. Things
 * that look like they belong but were left out on purpose: PROTON_NO_ESYNC and
 * PROTON_ENABLE_HDR (not in Proton 11), DXVK_ASYNC (removed from DXVK),
 * gamemoderun (already handled on the Deck), nested gamescope (the Deck's session
 * already is gamescope).
 */

export type PresetGroup = "Graphics" | "Crashes and hangs" | "Steam Deck" | "Video" | "Mods" | "Diagnostics";

export const PRESET_GROUPS: PresetGroup[] = [
  "Graphics",
  "Crashes and hangs",
  "Steam Deck",
  "Video",
  "Mods",
  "Diagnostics",
];

export interface LaunchPreset {
  id: string;
  alias: string;
  group: PresetGroup;
  /** The symptom it is for, in the words someone would describe it with. */
  useWhen: string;
  /** What it costs. Left out only when there is nothing to warn about. */
  tradeoff?: string;
  /** Only does anything under Proton, so hidden while Compatibility is None. */
  protonOnly: boolean;
  /** `VAR=value`, placed before %command%. */
  env?: string;
  /** A game argument, placed after %command%. */
  arg?: string;
  /** DLLs the game ships that Wine should prefer over its own. */
  dlls?: string[];
}

const dllPreset = (dll: string, alias: string, example: string): LaunchPreset => ({
  id: `dll-${dll}`,
  alias,
  group: "Mods",
  useWhen: `Mods using a ${dll}.dll loader do nothing, as with ${example}.`,
  tradeoff: "Does nothing unless that DLL is in the game folder.",
  protonOnly: true,
  dlls: [dll],
});

export const LAUNCH_PRESETS: LaunchPreset[] = [
  {
    id: "wined3d",
    alias: "Use OpenGL instead of Vulkan",
    group: "Graphics",
    useWhen: "Black screen or a crash on startup in a DirectX 9, 10 or 11 game.",
    tradeoff: "Usually much slower. Try the other fixes first.",
    protonOnly: true,
    env: "PROTON_USE_WINED3D=1",
  },
  {
    id: "no-d3d11",
    alias: "Hide DirectX 11 from the game",
    group: "Graphics",
    useWhen: "An older game has a DirectX 9 mode and its DirectX 11 mode crashes.",
    tradeoff: "A game that requires DirectX 11 will not start.",
    protonOnly: true,
    env: "PROTON_NO_D3D11=1",
  },
  {
    id: "no-d3d10",
    alias: "Hide DirectX 10 from the game",
    group: "Graphics",
    useWhen: "An older game has a DirectX 9 mode and its DirectX 10 mode crashes.",
    tradeoff: "A game that requires DirectX 10 will not start.",
    protonOnly: true,
    env: "PROTON_NO_D3D10=1",
  },
  {
    id: "old-gl",
    alias: "Shorten the OpenGL extension list",
    group: "Graphics",
    useWhen: "A very old OpenGL game crashes as soon as it starts.",
    protonOnly: true,
    env: "PROTON_OLD_GL_STRING=1",
  },
  {
    id: "unity-d3d11",
    alias: "Unity game: use DirectX 11",
    group: "Graphics",
    useWhen: "A Unity game crashes or looks broken under DirectX 12.",
    tradeoff: "Only understood by Unity games.",
    protonOnly: false,
    arg: "-force-d3d11",
  },
  {
    id: "unity-blank",
    alias: "Unity game: fix a blank screen",
    group: "Graphics",
    useWhen: "A Unity game shows a blank screen.",
    tradeoff: "Only helps some Unity games.",
    protonOnly: false,
    arg: "--in-process-gpu",
  },
  {
    id: "unreal-dx11",
    alias: "Unreal game: use DirectX 11",
    group: "Graphics",
    useWhen: "An Unreal Engine game crashes or stutters under DirectX 12.",
    tradeoff: "Only understood by Unreal games, and may drop DirectX 12 features.",
    protonOnly: false,
    arg: "-dx11",
  },
  {
    id: "no-fsync",
    alias: "Turn off fsync",
    group: "Crashes and hangs",
    useWhen: "The game freezes or hangs at random.",
    tradeoff: "Can lower performance in games that use many threads.",
    protonOnly: true,
    env: "PROTON_NO_FSYNC=1",
  },
  {
    id: "heap-delay",
    alias: "Delay freeing memory",
    group: "Crashes and hangs",
    useWhen: "Random crashes that Windows hides, often after a level or scene change.",
    tradeoff: "Uses a little more memory.",
    protonOnly: true,
    env: "PROTON_HEAP_DELAY_FREE=1",
  },
  {
    id: "heap-zero",
    alias: "Clear memory before the game uses it",
    group: "Crashes and hangs",
    useWhen: "Crashes or glitches that change from one launch to the next.",
    tradeoff: "A small performance cost.",
    protonOnly: true,
    env: "PROTON_HEAP_ZERO_MEMORY=1",
  },
  {
    id: "cpu-limit",
    alias: "Limit the game to 4 CPU threads",
    group: "Crashes and hangs",
    useWhen: "An older game crashes on startup or runs badly because of the thread count.",
    tradeoff: "Slower in newer games that use more than 4 threads.",
    protonOnly: true,
    env: "PROTON_CPU_TOPOLOGY=4:0,1,2,3",
  },
  {
    id: "not-deck",
    alias: "Don't tell the game this is a Deck",
    group: "Steam Deck",
    useWhen: "Graphics settings are hidden or locked low because the game detects a Deck.",
    tradeoff: "Deck-tuned defaults go away, so you may need to lower settings yourself.",
    protonOnly: false,
    env: "SteamDeck=0",
  },
  {
    id: "hide-vangogh",
    alias: "Hide the Deck's GPU from the game",
    group: "Steam Deck",
    useWhen: "A game refuses to run or misbehaves on the Deck's GPU specifically.",
    protonOnly: true,
    env: "PROTON_HIDE_VANGOGH_GPU=1",
  },
  {
    id: "no-xalia",
    alias: "Turn off the controller menu helper",
    group: "Steam Deck",
    useWhen: "Proton's Xalia overlay gets in the way of a launcher or menu.",
    tradeoff: "Launchers that need a mouse may no longer work with a controller.",
    protonOnly: true,
    env: "PROTON_USE_XALIA=0",
  },
  {
    id: "video-dxgi",
    alias: "Fix broken video playback",
    group: "Video",
    useWhen: "Cutscenes are black, frozen or garbled, or the game crashes when one starts.",
    protonOnly: true,
    env: "WINE_DO_NOT_CREATE_DXGI_DEVICE_MANAGER=1",
  },
  dllPreset("dinput8", "Load mods via dinput8", "many Souls and action game loaders"),
  dllPreset("version", "Load mods via version", "ASI and Cyberpunk-style loaders"),
  dllPreset("winmm", "Load mods via winmm", "ASI loaders and fixes shipped with the game"),
  dllPreset("winhttp", "Load mods via winhttp", "BepInEx in Unity games"),
  {
    id: "proton-log",
    alias: "Write a Proton log",
    group: "Diagnostics",
    useWhen: "You want to find out why a game fails. Writes ~/steam-<appid>.log.",
    tradeoff: "The log can get large and slows some games. Turn it off afterwards.",
    protonOnly: true,
    env: "PROTON_LOG=1",
  },
  {
    id: "mangohud",
    alias: "Show the MangoHud overlay",
    group: "Diagnostics",
    useWhen: "You want frame rate and load on screen in this game only.",
    protonOnly: false,
    env: "MANGOHUD=1",
  },
];

const COMMAND = "%command%";
const DLL_VAR = "WINEDLLOVERRIDES";
const DLL_MODE = "n,b";

interface Parsed {
  before: string[];
  after: string[];
}

/** Splits on spaces outside quotes, keeping the quotes on the token. */
function tokenize(options: string): string[] {
  return options.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
}

/** Text with no %command% is arguments, which is how Steam treats it too. */
function parse(options: string): Parsed {
  const tokens = tokenize(options);
  const index = tokens.indexOf(COMMAND);
  return index < 0
    ? { before: [], after: tokens }
    : { before: tokens.slice(0, index), after: tokens.slice(index + 1) };
}

function serialize({ before, after }: Parsed): string {
  if (before.length === 0 && after.length === 0) return "";
  return [...before, COMMAND, ...after].join(" ");
}

const isDllToken = (token: string) => token.startsWith(`${DLL_VAR}=`);
const isAssignment = (token: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);

/**
 * The shell only reads `VAR=value` as a variable in front of the first word, so
 * in `gamescope -- VAR=1 %command%` it would be taken for the program to run.
 */
function insertAssignment(before: string[], token: string): string[] {
  const firstWord = before.findIndex((item) => !isAssignment(item));
  const at = firstWord < 0 ? before.length : firstWord;
  return [...before.slice(0, at), token, ...before.slice(at)];
}

function readDllSections(before: string[]): { names: string[]; mode: string }[] {
  const token = before.find(isDllToken);
  if (!token) return [];
  return token
    .slice(DLL_VAR.length + 1)
    .replace(/["']/g, "")
    .split(";")
    .filter(Boolean)
    .map((section) => {
      const [names, mode = ""] = section.split("=");
      return { names: names.split(",").filter(Boolean), mode };
    });
}

function writeDllSections(before: string[], sections: { names: string[]; mode: string }[]): string[] {
  const kept = sections.filter((section) => section.names.length > 0);
  const value = kept.map((section) => `${section.names.join(",")}=${section.mode}`).join(";");
  const token = `${DLL_VAR}="${value}"`;
  const index = before.findIndex(isDllToken);
  if (kept.length === 0) return before.filter((item) => !isDllToken(item));
  if (index < 0) return insertAssignment(before, token);
  return before.map((item, position) => (position === index ? token : item));
}

/** Takes these DLLs out of every section, then adds them back under `mode` if wanted. */
function applyDlls(before: string[], names: string[], mode: string, on: boolean): string[] {
  const lowered = names.map((name) => name.toLowerCase());
  const sections = readDllSections(before).map((section) => ({
    ...section,
    names: section.names.filter((name) => !lowered.includes(name.toLowerCase())),
  }));
  if (on) {
    const target = sections.find((section) => section.mode === mode);
    if (target) target.names.push(...names);
    else sections.push({ names: [...names], mode });
  }
  return writeDllSections(before, sections);
}

export function isPresetOn(preset: LaunchPreset, options: string): boolean {
  const { before, after } = parse(options);
  if (preset.env) return before.includes(preset.env);
  if (preset.arg) return after.includes(preset.arg);
  const present = readDllSections(before).flatMap((section) =>
    section.names.map((name) => name.toLowerCase()),
  );
  return (preset.dlls ?? []).every((dll) => present.includes(dll.toLowerCase()));
}

export function countActivePresets(options: string, custom: CustomPreset[] = []): number {
  return (
    LAUNCH_PRESETS.filter((preset) => isPresetOn(preset, options)).length +
    custom.filter((preset) => isCustomPresetOn(preset, options)).length
  );
}

export function setPreset(preset: LaunchPreset, options: string, on: boolean): string {
  const parsed = parse(options);

  if (preset.env) {
    // Replaces the variable rather than adding a second, conflicting copy of it.
    const name = preset.env.slice(0, preset.env.indexOf("=") + 1);
    const others = parsed.before.filter((token) => !token.startsWith(name));
    parsed.before = on ? insertAssignment(others, preset.env) : others;
  } else if (preset.arg) {
    const others = parsed.after.filter((token) => token !== preset.arg);
    parsed.after = on ? [...others, preset.arg] : others;
  } else if (preset.dlls) {
    parsed.before = applyDlls(parsed.before, preset.dlls, DLL_MODE, on);
  }

  return serialize(parsed);
}

/** What the toggle adds to the launch options, shown so nothing is hidden. */
export function presetOption(preset: LaunchPreset): string {
  return preset.env ?? preset.arg ?? `${DLL_VAR}="${preset.dlls?.join(",")}=${DLL_MODE}"`;
}

/** A preset the user wrote: a name, and what they would type into Launch options. */
export interface CustomPreset {
  id: string;
  alias: string;
  options: string;
}

interface CustomParts {
  assignments: string[];
  wrapper: string[];
  dlls: { names: string[]; mode: string }[];
  args: string[];
}

function customParts(text: string): CustomParts {
  let { before, after } = parse(text);
  // Steam would pass a bare `VAR=1` to the game as an argument, which is never
  // what someone saving it as a preset means.
  if (!tokenize(text).includes(COMMAND)) {
    const firstWord = after.findIndex((token) => !isAssignment(token));
    const count = firstWord < 0 ? after.length : firstWord;
    before = after.slice(0, count);
    after = after.slice(count);
  }
  return {
    assignments: before.filter((token) => isAssignment(token) && !isDllToken(token)),
    wrapper: before.filter((token) => !isAssignment(token)),
    dlls: readDllSections(before),
    args: after,
  };
}

/** Where `run` appears in `tokens` as consecutive items, or -1. */
function findRun(tokens: string[], run: string[]): number {
  for (let at = 0; at + run.length <= tokens.length; at += 1) {
    if (run.every((token, offset) => tokens[at + offset] === token)) return at;
  }
  return -1;
}

function removeRun(tokens: string[], run: string[]): string[] {
  const at = run.length > 0 ? findRun(tokens, run) : -1;
  return at < 0 ? tokens : [...tokens.slice(0, at), ...tokens.slice(at + run.length)];
}

/** Why this cannot be saved, in words for the panel, or "" when it can. */
export function customPresetProblem(alias: string, options: string): string {
  if (!alias.trim()) return "Give the preset a name.";
  if ((options.match(/"/g)?.length ?? 0) % 2 === 1 || (options.match(/'/g)?.length ?? 0) % 2 === 1) {
    return "A quote in the launch options is not closed.";
  }
  const { assignments, wrapper, dlls, args } = customParts(options);
  if (assignments.length + wrapper.length + dlls.length + args.length === 0) {
    return "Enter the launch options it should add.";
  }
  return "";
}

export function isCustomPresetOn(preset: CustomPreset, options: string): boolean {
  const { assignments, wrapper, dlls, args } = customParts(preset.options);
  if (assignments.length + wrapper.length + dlls.length + args.length === 0) return false;

  const { before, after } = parse(options);
  const sections = readDllSections(before);
  const hasDll = (name: string, mode: string) =>
    sections.some(
      (section) =>
        section.mode === mode &&
        section.names.some((present) => present.toLowerCase() === name.toLowerCase()),
    );

  return (
    assignments.every((token) => before.includes(token)) &&
    (wrapper.length === 0 || findRun(before, wrapper) >= 0) &&
    (args.length === 0 || findRun(after, args) >= 0) &&
    dlls.every((section) => section.names.every((name) => hasDll(name, section.mode)))
  );
}

export function setCustomPreset(preset: CustomPreset, options: string, on: boolean): string {
  const parts = customParts(preset.options);
  const parsed = parse(options);

  let before = removeRun(parsed.before, parts.wrapper);
  for (const token of parts.assignments) {
    if (on) {
      // Replaces the variable rather than adding a second, conflicting copy of it.
      const name = token.slice(0, token.indexOf("=") + 1);
      before = insertAssignment(before.filter((item) => !item.startsWith(name)), token);
    } else {
      before = before.filter((item) => item !== token);
    }
  }
  for (const section of parts.dlls) before = applyDlls(before, section.names, section.mode, on);
  if (on) before = [...before, ...parts.wrapper];

  const after = removeRun(parsed.after, parts.args);
  return serialize({ before, after: on ? [...after, ...parts.args] : after });
}
