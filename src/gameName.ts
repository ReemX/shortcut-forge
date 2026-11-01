/**
 * Turns an executable's path into the name a person would give the game.
 *
 * `/Games/Moon Sweepers/MoonSweepers.exe` becomes "Moon Sweepers", and
 * `/Games/Hollow Knight/bin/game.exe` takes its name from the folder because the
 * file's own name says nothing. It is only a starting point, since the name stays
 * editable in the form.
 */

/** File names that say nothing about the game, so the folder is asked instead. */
const GENERIC_FILES = new Set([
  "app", "apprun", "bin", "client", "game", "launch", "launcher", "main", "play", "run",
  "runner", "setup", "start", "starter",
]);

/** Folders that sit between a game's own folder and its executable. */
const GENERIC_FOLDERS = new Set([
  "bin", "bin32", "bin64", "binaries", "build", "common", "dist", "drive_c", "exe", "files",
  "game", "games", "linux", "linux64", "program files", "program files (x86)", "release",
  "retail", "shipping", "win32", "win64", "windows", "x64", "x86", "x86_64",
]);

/** Build and platform words that end up in file names but not in a game's title. */
const NOISE = /^(win(dows)?(32|64)?|linux(32|64)?|x(64|86)|x86_64|amd64|i[36]86|64bit|32bit|shipping|release|retail|debug|portable|launcher|v?\d+(\.\d+){1,}[a-z]?|v\d+)$/i;

const LOWERCASE_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to"]);

const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Everything before the last extension. */
function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** Inserts the spaces missing from "MoonSweepers", "HTTPServer" and "Left4Dead2". */
function splitJoinedWords(word: string): string {
  return word
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/(\p{L})(\d)/gu, "$1 $2")
    .replace(/(\p{L}\s?\d+)(\p{Lu})/gu, "$1 $2")
    // The one common capitalisation the rules above get wrong.
    .replace(/\bMc (\p{Lu})/gu, "Mc$1");
}

function titleCase(words: string[]): string[] {
  return words.map((word, index) => {
    if (index > 0 && LOWERCASE_WORDS.has(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
}

/** Tidies one raw name, returning "" when nothing but noise was in it. */
function format(raw: string): string {
  const cleaned = raw
    // [Repack], (GOG), {v1.2} and the like are never part of the title.
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ")
    // A release-style name: "Moon.Sweepers-GROUP".
    .replace(/^([^\s]*\.[^\s]*)-[A-Z0-9]{2,}$/, "$1")
    // Removed whole, before the dots in them can be taken for separators.
    .replace(/[\s_.\-]+(v?\d+(\.\d+)+[a-z]?|x86[_-]64)(?=$|[\s_.\-])/gi, "");

  const isLowercase = cleaned === cleaned.toLowerCase();
  // A dash is a separator in "moon-sweepers", but part of the name in "Half-Life".
  const separators = isLowercase ? /[\s_.\-+]+/ : /[\s_.+]+|\s-\s|-(?=win|linux|shipping|x64|x86|v?\d)/i;

  const words = cleaned
    .split(separators)
    .filter(Boolean)
    .flatMap((word) => (NOISE.test(word) ? [] : splitJoinedWords(word).split(/\s+/)))
    .filter((word) => !NOISE.test(word));

  return (isLowercase ? titleCase(words) : words).join(" ");
}

/** The nearest folder above the file whose name says something. */
function folderName(parts: string[]): string {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (GENERIC_FOLDERS.has(parts[index].toLowerCase())) continue;
    const name = format(parts[index]);
    if (name) return name;
  }
  return "";
}

export function suggestGameName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  const fileName = parts.pop() ?? "";
  const stem = stemOf(fileName);
  const fromFile = format(stem);
  const fromFolder = folderName(parts);

  if (!fromFile || GENERIC_FILES.has(squash(fromFile))) return fromFolder || fromFile || stem;

  // The folder's spelling is the better one when both name the same game, since
  // somebody chose it to be read: "Moon Sweepers" over "MoonSweepers", and "The
  // Witcher 3" over "witcher3".
  if (fromFolder && squash(fromFolder).includes(squash(fromFile))) return fromFolder;
  return fromFile;
}
