import type { Application, SavedShortcut } from "./backend";

/** Every word has to appear somewhere in the application's name, source or command. */
export function matchesQuery(application: Application, query: string): boolean {
  const haystack = [application.name, application.source, application.args, application.exe].join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/**
 * Something the user installed, or a game wherever it came from. On a Deck most
 * entries are SteamOS's own tools, which nobody is looking for here.
 */
export const isOwnApplication = (application: Application) =>
  application.source !== "System" || application.categories.includes("Game");

/** Yours first, the rest apart. Keeps the backend's alphabetical order within each. */
export function splitApplications(applications: Application[]): { own: Application[]; system: Application[] } {
  return {
    own: applications.filter(isOwnApplication),
    system: applications.filter((application) => !isOwnApplication(application)),
  };
}

/**
 * The shortcut already made from this application, if any. Every Flatpak has the
 * same executable, so a shortcut only counts if it also carries the arguments.
 */
export function savedShortcutFor(application: Application, saved: SavedShortcut[]): SavedShortcut | undefined {
  return saved.find(
    (shortcut) => shortcut.exe === application.exe && (shortcut.launch_options ?? "").includes(application.args),
  );
}

/** Steam cannot show an SVG as a shortcut's icon, so those are left to the artwork. */
export const usableIcon = (application: Application) => (/\.svg$/i.test(application.icon_path) ? "" : application.icon_path);

/** What the row says at its end. A plain "User" or "System" would tell you nothing. */
export function applicationTag(application: Application, inLibrary: boolean): string | undefined {
  if (inLibrary) return "In library";
  return application.source === "Flatpak" || application.source === "Snap" ? application.source : undefined;
}
