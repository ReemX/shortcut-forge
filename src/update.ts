import { Navigation } from "@decky/ui";
import { toaster } from "@decky/api";

import type { UpdateCheck } from "./backend";

const PLUGIN_NAME = "Shortcut Forge";
const RELEASES_PAGE = "github.com/ReemX/shortcut-forge/releases/latest";
/** Decky's `InstallType.UPDATE`, which words its confirmation as an update. */
const INSTALL_TYPE_UPDATE = 2;

interface DeckyGlobals {
  DeckyBackend?: { call(route: string, ...args: unknown[]): Promise<unknown> };
  DeckyPluginLoader?: { deckyState?: { closeActivePlugin?(): void } };
}

/**
 * Hands the update to Decky, which is what its own store does: it asks for
 * confirmation, checks the download against the hash, replaces the plugin and
 * reloads it. The settings folder is left alone, so the key and presets stay.
 *
 * `DeckyBackend` is a global rather than a documented API, because plugins outside
 * the store are not expected to update themselves. If it ever goes, this says where
 * to get the update instead of failing silently.
 */
export async function installUpdate(update: UpdateCheck): Promise<void> {
  const decky = window as unknown as DeckyGlobals;
  const backend = decky.DeckyBackend;
  try {
    if (!backend) throw new Error("Decky's installer was not found");
    // Decky keeps showing the plugin that is open, old code and all, until it is
    // closed. Left open, this panel would still offer the update it just installed.
    decky.DeckyPluginLoader?.deckyState?.closeActivePlugin?.();
    // The confirmation opens over the main window, behind this panel.
    Navigation.CloseSideMenus();
    await backend.call("utilities/install_plugin", update.artifact, PLUGIN_NAME, update.version, update.hash, INSTALL_TYPE_UPDATE);
  } catch (error) {
    console.error("[shortcut-forge] could not start the update", error);
    toaster.toast({ title: "Could not start the update", body: `Get it from ${RELEASES_PAGE}` });
  }
}
