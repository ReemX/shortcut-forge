import {
  Dropdown,
  Navigation,
  PanelSection,
  PanelSectionRow,
  showModal,
  staticClasses,
} from "@decky/ui";
import type { DropdownOption, SingleDropdownOption } from "@decky/ui";
import { FileSelectionType, definePlugin, openFilePicker, toaster } from "@decky/api";
import { useEffect, useRef, useState } from "react";
import { FaArrowRotateLeft, FaBan, FaChevronRight, FaFolderTree, FaGear, FaHammer, FaImage, FaKey, FaPowerOff, FaSliders, FaTerminal, FaThumbtack, FaUpRightFromSquare } from "react-icons/fa6";

import {
  checkSteamGridDb,
  getArtworkSettings,
  getCustomPresets,
  getDefaultFolder,
  setDefaultFolder,
  getRestartPreference,
  inspectPath,
  listLocations,
  listSavedShortcuts,
  log,
  makeExecutable,
  ping,
  rememberDirectory,
  setArtworkEnabled,
  setRestartPreference,
  setSteamGridDbKey,
} from "./backend";
import type {
  ArtworkSettings,
  Location,
  Locations,
  PathInfo,
  RestartPreference,
} from "./backend";
import { fetchArtwork } from "./artwork";
import { PLUGIN_VERSION } from "./version";
import { LocationList } from "./LocationList";
import { ProgressRow } from "./ProgressRow";
import { SavedGames } from "./SavedGames";
import { TextEntry, usePanelVisible } from "./TextEntry";
import { describePathLocally } from "./pathinfo";
import { RestartPrompt } from "./RestartPrompt";
import {
  addNonSteamShortcut,
  addToCollection,
  getCompatibilityTools,
  listCollections,
  pickDefaultCompatTool,
  removeShortcut,
  restartSteam,
  setShortcutIcon,
} from "./steam";
import type { CollectionSummary, CompatibilityTool } from "./steam";
import { LaunchOptionsScreen } from "./LaunchPresetList";
import { ArtCard, ArtworkScreen, useArtPreview } from "./ArtCard";
import { countActivePresets, type CustomPreset } from "./launchPresets";
import { FileBrowser } from "./FileBrowser";
import { suggestGameName } from "./gameName";
import { GroupHeading, ListGroup, ListRow, Notice, PrimaryRow, Screen, ScreenHeader, ToggleRow } from "./ListRow";
import { NEW_COLLECTION, clearSelection, getDraft, updateDraft, useDraft } from "./store";
import type { AddedShortcut } from "./store";

const NO_COMPAT_TOOL = "";

/** The panel is a small stack: the main screen, and one level below it. */
type PanelScreen = "main" | "launch" | "artwork" | "settings";

/** The library's Non-Steam tab. "DesktopApps" is Steam's own id for it. */
const NON_STEAM_TAB = "/library/tab/DesktopApps";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Used until the backend answers, and if it never does: artwork on, no key, so
// the panel offers the feature instead of hiding it.
const ARTWORK_UNKNOWN: ArtworkSettings = {
  enabled: true,
  key: "",
  key_url: "steamgriddb.com/profile/preferences/api",
  slots: [],
};

/**
 * Put every scrollable ancestor back to the top.
 *
 * `alwaysRender` keeps this component mounted between visits, so Steam reopens
 * the panel wherever it was last scrolled to — usually somewhere in the middle
 * of a long folder.
 */
function scrollToTop(anchor: HTMLElement | null): void {
  for (let node = anchor?.parentElement; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 1) node.scrollTop = 0;
  }
}

function Content() {
  // The in-progress game lives outside React so it survives the Quick Access
  // panel being unmounted while the file picker is open. See ./store.
  const {
    browsePath,
    duplicateOf,
    target,
    name,
    artworkName,
    launchOptions,
    compatTool,
    collectionId,
    newCollectionName,
    added,
    addError,
  } = useDraft();

  const [locations, setLocations] = useState<Locations | null>(null);
  const [defaultFolder, setDefaultFolderState] = useState("");
  // For the effects below, which must see the current value whenever they run.
  const defaultFolderRef = useRef("");
  const [compatTools, setCompatTools] = useState<CompatibilityTool[]>([]);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [restartPreference, setRestartPreferenceState] = useState<RestartPreference>("never");
  const [artworkSettings, setArtworkSettings] = useState<ArtworkSettings>(ARTWORK_UNKNOWN);
  const [keyStatus, setKeyStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [versionWarning, setVersionWarning] = useState("");
  const [screen, setScreen] = useState<PanelScreen>("main");
  /** The row to put focus back on when a screen closes, so B returns to where you were. */
  const [returnTo, setReturnTo] = useState<PanelScreen>("main");
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([]);

  const panelVisible = usePanelVisible();
  const topAnchor = useRef<HTMLDivElement>(null);

  const artState = useArtPreview(artworkName.trim() || name, artworkSettings);

  const openScreen = (next: PanelScreen) => {
    setReturnTo("main");
    setScreen(next);
  };
  const closeScreen = () => {
    setReturnTo(screen);
    setScreen("main");
  };

  // Each screen starts at its top, wherever the last one was scrolled to.
  useEffect(() => {
    const frame = requestAnimationFrame(() => scrollToTop(topAnchor.current));
    return () => cancelAnimationFrame(frame);
  }, [screen, Boolean(target)]);

  useEffect(() => {
    if (!panelVisible) return;
    // Collections and compatibility tools can change elsewhere in Steam while
    // the panel sits mounted, so re-read them rather than caching from first mount.
    setCollections(listCollections());
    getCompatibilityTools().then(setCompatTools);
    // Every new entry starts from the default folder, wherever the last one ended.
    if (defaultFolderRef.current && !getDraft().target) updateDraft({ browsePath: defaultFolderRef.current });
    // The key can be saved or changed outside this mounted panel too.
    refreshArtworkSettings().catch(() => {});
    // One frame later, so the panel has laid out before we reset it.
    const frame = requestAnimationFrame(() => scrollToTop(topAnchor.current));
    return () => cancelAnimationFrame(frame);
  }, [panelVisible]);

  useEffect(() => {
    listLocations()
      .then((result) => {
        setLocations(result);
        setBackendError(null);
      })
      .catch((error) => {
        console.error("[shortcut-forge] could not list locations", error);
        setBackendError(
          "The plugin's Python backend is not responding. Browsing still works, but folder shortcuts and saved-game checks do not.",
        );
        setLocations({ recent: null, places: [], drives: [] });
      });
    getDefaultFolder()
      .then((folder) => {
        defaultFolderRef.current = folder;
        setDefaultFolderState(folder);
        if (folder && !getDraft().target && !getDraft().browsePath) updateDraft({ browsePath: folder });
      })
      .catch(() => {});
    // A zip that only half-installed leaves the Python and the panel on
    // different versions, and every symptom after that is misleading.
    ping()
      .then((backend) => {
        if (backend !== PLUGIN_VERSION) {
          setVersionWarning(
            `This install is half-updated: the Python backend is v${backend} and this panel is v${PLUGIN_VERSION}. Reinstall the plugin and restart plugin_loader.`,
          );
        }
      })
      .catch(() => {});
    getRestartPreference().then(setRestartPreferenceState).catch(() => {});
    getArtworkSettings().then(setArtworkSettings).catch(() => {});
    getCustomPresets().then(setCustomPresets).catch(() => {});
  }, []);

  // The compat tool list loads asynchronously, so a file picked before it
  // arrives gets its Proton default applied here instead.
  // Once per file: the list is re-read whenever the panel opens, and that must not
  // undo someone choosing None on purpose.
  const defaultedTarget = useRef<PathInfo | null>(null);
  useEffect(() => {
    if (!target || compatTools.length === 0 || defaultedTarget.current === target) return;
    defaultedTarget.current = target;
    if (target.is_windows_app && compatTool === NO_COMPAT_TOOL) {
      updateDraft({ compatTool: pickDefaultCompatTool(compatTools) });
    }
  }, [compatTools, target]);

  /** Steam's full-screen picker, for when the plugin's backend cannot list folders. */
  const openSystemPicker = async (path: string) => {
    let picked: { path: string; realpath: string };
    try {
      picked = await openFilePicker(
        FileSelectionType.FILE,
        path,
        true, // browse files
        true, // and folders, so the user can navigate
        undefined, // no filter: Linux game binaries often have no extension
        undefined,
        false, // hidden files off by default
        true, // but let the picker offer "all files"
      );
    } catch {
      return; // the picker rejects when the user backs out
    }

    await onFilePicked(picked.path);
  };

  const onFilePicked = async (path: string) => {
    // The backend describes the file better than we can, but a backend problem
    // must never strand the user on a picker that appears to do nothing.
    let info: PathInfo;
    try {
      info = await inspectPath(path);
      setBackendError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[shortcut-forge] inspect_path failed", error);
      setBackendError(`The plugin's Python backend is not responding (${message}).`);
      info = describePathLocally(path);
    }

    updateDraft({
      added: null,
      addError: null,
      target: info,
      duplicateOf: "",
      name: suggestGameName(info.path),
      compatTool: info.is_windows_app ? pickDefaultCompatTool(compatTools) : NO_COMPAT_TOOL,
    });
    openScreen("main");

    // Steam saves a new shortcut within seconds, so this includes recent adds.
    listSavedShortcuts()
      .then((saved) => {
        const match = saved.shortcuts.find((shortcut) => shortcut.exe === info.path);
        if (match && getDraft().target === info) updateDraft({ duplicateOf: match.name });
      })
      .catch(() => {});

    rememberDirectory(info.directory)
      .then(() => listLocations().then(setLocations))
      .catch(() => {});
  };

  const onMakeExecutable = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const result = await makeExecutable(target.path);
      if (result.success) {
        updateDraft({ target: await inspectPath(target.path) });
        toaster.toast({ title: "Shortcut Forge", body: "Marked as executable" });
      } else {
        toaster.toast({ title: "Could not mark as executable", body: result.error ?? "Unknown error" });
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * Offer, or take, the restart that makes the new shortcut's icon appear.
   *
   * `hold` stops an automatic restart. Something went wrong that the panel is
   * currently explaining, and restarting Steam takes the explanation with it —
   * which is how "it added the game and did nothing else" happens.
   */
  const promptRestart = async (gameName: string, hold = false) => {
    const preference = await getRestartPreference().catch(() => "never" as RestartPreference);

    if (preference === "always") {
      if (hold) return;
      // Long enough to see what just happened before the client goes down.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      restartSteam();
      return;
    }
    if (preference === "never") return;

    showModal(
      <RestartPrompt
        gameName={gameName}
        onDecision={(restart, remember) => {
          if (remember) {
            const choice: RestartPreference = restart ? "always" : "never";
            setRestartPreferenceState(choice);
            setRestartPreference(choice).catch(() => {});
          }
          if (restart) restartSteam();
        }}
      />,
    );
  };

  /**
   * File the new shortcut into the chosen collection, if any.
   *
   * Returns the collection's name on success, or null when none was chosen or
   * the write failed — the game itself is already added either way.
   */
  const fileIntoCollection = async (appId: number): Promise<string | null> => {
    if (!collectionId) return null;

    const creating = collectionId === NEW_COLLECTION;
    const collectionName = creating
      ? newCollectionName.trim()
      : (collections.find((collection) => collection.id === collectionId)?.name ?? "");

    if (!collectionName) return null;

    try {
      await addToCollection(appId, {
        id: creating ? undefined : collectionId,
        name: collectionName,
      });
      setCollections(listCollections());
      return collectionName;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", `Could not add to collection "${collectionName}": ${message}`).catch(() => {});
      toaster.toast({ title: "Could not add to collection", body: message });
      return null;
    }
  };

  /**
   * Fetch SteamGridDB artwork for a game that has already been added.
   *
   * Nothing here can fail the add — the game is in the library by now — so every
   * outcome, including "no API key", ends up as a line under "Last added".
   */
  const downloadArtworkFor = async (
    appId: number,
    searchName: string,
    slots: string[],
  ) => {
    // The user can add another game while this runs, so only ever patch the
    // entry this download belongs to.
    const patch = (fields: Partial<AddedShortcut>) => {
      const current = getDraft().added;
      if (current?.appId === appId) updateDraft({ added: { ...current, ...fields } });
    };

    const artwork = await fetchArtwork(appId, searchName, slots, (progress) =>
      patch({ artworkProgress: progress }),
    );

    if (artwork.iconPath) setShortcutIcon(appId, artwork.iconPath);

    patch({ artwork, artworkProgress: null });
    return artwork;
  };

  /**
   * Re-read the artwork settings, and bring the panel into step with them.
   *
   * The copy loaded at mount is the only one the panel has, so a single failed
   * read used to mean no artwork — and no slot list — for the rest of the
   * session, silently.
   */
  const refreshArtworkSettings = async (): Promise<ArtworkSettings> => {
    const settings = await getArtworkSettings().catch(() => artworkSettings);
    // Not while a key is still on its way to disk: this would put the old one
    // back in the field underneath whoever is typing.
    if (unsavedKey.current === null) setArtworkSettings(settings);
    return settings;
  };

  /**
   * Fetch artwork for the game just added, on demand.
   *
   * Reachable whether or not the automatic attempt ran, since "it downloaded
   * nothing" and "it was never asked to" look the same from the panel.
   */
  const retryArtwork = async () => {
    const current = getDraft().added;
    if (!current) return;

    await flushArtworkKey();
    const settings = await refreshArtworkSettings();
    await downloadArtworkFor(current.appId, current.searchName.trim(), settings.slots);
  };

  const onAddToSteam = async () => {
    if (!target) return;
    const gameName = name.trim();
    // Artwork is searched for under the real title when the library name is not
    // one SteamGridDB would recognise.
    const searchName = artworkName.trim() || gameName;
    setBusy(true);
    try {
      updateDraft({ addError: null });
      const result = await addNonSteamShortcut({
        name: gameName,
        exe: target.path,
        startDir: target.directory,
        launchOptions: launchOptions.trim(),
        compatTool,
      });

      // The game exists at this point, so a collection failure is reported but
      // never turned into a failed add.
      const filedInto = await fileIntoCollection(result.appId);

      log("info", `Added "${gameName}": ${result.log.join(" | ")}`).catch(() => {});
      updateDraft({
        added: {
          appId: result.appId,
          name: gameName,
          verified: result.verified,
          collection: filedInto ?? undefined,
          searchName,
          artwork: null,
          artworkProgress: null,
        },
        target: null,
        browsePath: defaultFolderRef.current || null,
        name: "",
        artworkName: "",
        launchOptions: "",
        compatTool: NO_COMPAT_TOOL,
        collectionId: "",
        newCollectionName: "",
      });

      toaster.toast({
        title: result.verified ? "Added to Steam" : "Added, but not confirmed",
        body: gameName,
      });

      // "Last added" is the top section now, but the panel is still scrolled to
      // wherever the form's button was — and the artwork progress that appears
      // there is the only thing on screen saying the download is happening.
      scrollToTop(topAnchor.current);

      // Show the game where it landed straight away. The panel stays mounted, so
      // artwork carries on and appears in the library as it arrives. Waiting for
      // it left several idle-looking seconds in which B walked up the folders.
      // Only a shortcut Steam did not confirm keeps the panel open, to say so.
      if (result.verified) {
        Navigation.Navigate(NON_STEAM_TAB);
        Navigation.CloseSideMenus();
      }

      // Read the settings back instead of trusting what was loaded at mount: if
      // that one read failed, artwork would be skipped for the rest of the
      // session with nothing to show it had been.
      const settings = await refreshArtworkSettings();

      // Before the restart, and awaited: a restart while art is still being
      // applied loses the rest of it.
      let artworkFailed = false;
      if (settings.enabled) {
        // A key typed a moment ago may still be waiting out its debounce, and
        // the backend can only use what it has been given.
        await flushArtworkKey();
        const artwork = await downloadArtworkFor(
          result.appId,
          searchName,
          settings.slots,
        );
        artworkFailed = !artwork.success;
        toaster.toast({
          title: artwork.success ? "Artwork applied" : "No artwork",
          body: artwork.success ? artwork.applied.join(", ") : artwork.error,
        });
      }

      // An automatic restart is skipped when the artwork failed: the reason is
      // on screen, and restarting is what would take it away unread.
      await promptRestart(gameName, artworkFailed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", `Could not add "${gameName}": ${message}`).catch(() => {});
      // A toast is easy to miss in Game Mode, and this is the failure the user
      // most needs to see, so it also stays on screen.
      updateDraft({ addError: message });
      toaster.toast({ title: "Could not add the game", body: message });
    } finally {
      setBusy(false);
    }
  };

  const onUndo = () => {
    if (!added) return;
    removeShortcut(added.appId);
    toaster.toast({ title: "Removed from Steam", body: added.name });
    updateDraft({ added: null });
  };

  const onChangeRestartPreference = (value: RestartPreference) => {
    setRestartPreferenceState(value);
    setRestartPreference(value).catch(() => {});
  };

  // A settings write per keystroke would be silly, so the key is saved once
  // typing stops. Deliberately not cancelled on unmount: the panel can be
  // hidden mid-edit, and the key still has to be saved.
  const keySaveTimer = useRef<number | undefined>(undefined);
  /** The key waiting on that timer, or null when nothing is pending. */
  const unsavedKey = useRef<string | null>(null);

  /**
   * Ask SteamGridDB whether the saved key actually works.
   *
   * Run after every save, so a key that was mistyped, truncated by a partial
   * paste or never written to disk says so there and then rather than at the
   * next add — which is several steps later and easy to blame on something else.
   */
  const checkKey = async () => {
    setKeyStatus("Checking the key with SteamGridDB…");
    try {
      const result = await checkSteamGridDb();
      setKeyStatus(result.ok ? `SteamGridDB: ${result.detail}.` : `Not usable: ${result.detail}.`);
    } catch (error) {
      setKeyStatus(`Could not reach the plugin's backend: ${message(error)}.`);
    }
  };

  const saveKey = async (key: string) => {
    unsavedKey.current = null;
    try {
      await setSteamGridDbKey(key);
    } catch (error) {
      setKeyStatus(`Could not save the key: ${message(error)}.`);
      return;
    }
    if (key.trim()) await checkKey();
    else setKeyStatus("");
  };

  /** Save a debounced key right now, for when something is about to need it. */
  const flushArtworkKey = async () => {
    const key = unsavedKey.current;
    if (key === null) return;
    clearTimeout(keySaveTimer.current);
    await saveKey(key);
  };

  const onChangeArtwork = (patch: Partial<ArtworkSettings>) => {
    setArtworkSettings((current) => ({ ...current, ...patch }));

    if (patch.enabled !== undefined) setArtworkEnabled(patch.enabled).catch(() => {});
    if (patch.key !== undefined) {
      const key = patch.key;
      clearTimeout(keySaveTimer.current);
      unsavedKey.current = key;
      keySaveTimer.current = window.setTimeout(() => {
        saveKey(key).catch(() => {});
      }, 700);
    }
  };

  const compatOptions = [
    { data: NO_COMPAT_TOOL, label: "None (native Linux game)" },
    ...compatTools.map((tool) => ({ data: tool.strToolName, label: tool.strDisplayName })),
  ];

  const collectionOptions = [
    { data: "", label: "None" },
    ...collections.map((collection) => ({ data: collection.id, label: collection.name })),
    { data: NEW_COLLECTION, label: "New collection…" },
  ];

  // Choosing "New collection…" without naming it would silently file the game
  // nowhere, so block the add until there is a name.
  const collectionReady = collectionId !== NEW_COLLECTION || Boolean(newCollectionName.trim());
  const canAdd = !busy && Boolean(name.trim()) && collectionReady;

  const presetsOn = countActivePresets(launchOptions, customPresets);

  const needsExecutableBit = Boolean(
    target && target.exists && !target.is_dir && !target.is_windows_app && !target.is_executable,
  );

  const places = locations
    ? [...(locations.recent ? [locations.recent] : []), ...locations.places].filter(
        // Nobody keeps a game in Pictures, and Home still reaches them.
        (place) => !["pictures", "videos", "music"].includes(place.kind),
      )
    : [];
  const onLocationSelected = (location: Location) => updateDraft({ browsePath: location.path });

  // A failed add leaves the form on screen, a successful one returns to
  // browsing, so this has to render in both.
  const errorBanner = addError ? (
    <>
      <Notice>{addError}</Notice>
      <ListGroup>
        <ListRow icon={<FaBan />} label="Dismiss" onSelect={() => updateDraft({ addError: null })} />
      </ListGroup>
    </>
  ) : null;

  /** Saved straight away: this is a preference, not part of the game being added. */
  const applyDefaultFolder = (folder: string) => {
    setDefaultFolder(folder)
      .then((saved) => {
        defaultFolderRef.current = saved;
        setDefaultFolderState(saved);
      })
      .catch(() => toaster.toast({ title: "Could not save the default folder", body: "The plugin's backend is not responding." }));
  };

  const toggleDefaultFolder = () => {
    if (browsePath) applyDefaultFolder(browsePath === defaultFolder ? "" : browsePath);
  };

  const settingsScreen = (
    <SettingsScreen
      value={restartPreference}
      onChange={onChangeRestartPreference}
      artwork={artworkSettings}
      onChangeArtwork={onChangeArtwork}
      keyStatus={keyStatus}
      onCheckKey={checkKey}
      defaultFolder={defaultFolder}
      onClearDefaultFolder={() => applyDefaultFolder("")}
      onBack={closeScreen}
    />
  );

  // Browsing is the whole panel until a file is chosen; after that the form
  // takes over so the user is not scrolling past a sidebar to reach it.
  const browse = (
    <Screen
      onBack={browsePath ? () => updateDraft({ browsePath: null }) : undefined}
      secondaryLabel={browsePath ? (browsePath === defaultFolder ? "Clear default folder" : "Open here by default") : undefined}
      onSecondary={browsePath ? toggleDefaultFolder : undefined}
    >
      {backendError && <Notice>{backendError}</Notice>}
      {versionWarning && <Notice>{versionWarning}</Notice>}
      {errorBanner}

      {added && (
        <AddedSection
          added={added}
          artworkReady={artworkSettings.enabled && Boolean(artworkSettings.key.trim())}
          onUndo={onUndo}
          onArtwork={retryArtwork}
          onChangeSearchName={(searchName) => {
            const current = getDraft().added;
            if (current) updateDraft({ added: { ...current, searchName } });
          }}
        />
      )}

      {browsePath ? (
        <FileBrowser
          path={browsePath}
          defaultFolder={defaultFolder}
          onToggleDefault={toggleDefaultFolder}
          home={locations?.places.find((place) => place.kind === "home")?.path ?? ""}
          onNavigate={(next) => updateDraft({ browsePath: next })}
          onExit={() => updateDraft({ browsePath: null })}
          onPick={onFilePicked}
          onSystemPicker={() => openSystemPicker(browsePath)}
        />
      ) : (
        <>
          {defaultFolder && (
            <>
              <GroupHeading>Default folder</GroupHeading>
              <ListGroup>
                <ListRow icon={<FaThumbtack />} label={defaultFolder.split("/").pop() || defaultFolder} onSelect={() => updateDraft({ browsePath: defaultFolder })} />
              </ListGroup>
            </>
          )}
          <GroupHeading>Places</GroupHeading>
          {places.length > 0 ? (
            <LocationList locations={places} takeFocus onSelect={onLocationSelected} />
          ) : (
            <div style={{ fontSize: "12px", opacity: 0.7 }}>Loading…</div>
          )}

          <GroupHeading>Drives</GroupHeading>
          {locations && locations.drives.length > 0 ? (
            <LocationList locations={locations.drives} onSelect={onLocationSelected} />
          ) : (
            <div style={{ fontSize: "12px", opacity: 0.7 }}>No SD card or external drives connected.</div>
          )}
          <div style={{ height: "3px" }} />
          <ListGroup>
            <ListRow icon={<FaFolderTree />} label="Browse the whole Deck" onSelect={() => updateDraft({ browsePath: "/" })} />
          </ListGroup>
        </>
      )}

      <div style={{ height: "10px" }} />
      <ListGroup>
        <ListRow
          icon={<FaGear />}
          label="Settings"
          trailing={artworkSettings.enabled && !artworkSettings.key.trim() ? "Artwork key missing" : undefined}
          takeFocus={returnTo === "settings"}
          onSelect={() => openScreen("settings")}
        />
      </ListGroup>
    </Screen>
  );

  const form = target && (
    <Screen onBack={clearSelection}>
      {errorBanner}

      <ArtCard
        state={artState}
        name={name}
        takeFocus={returnTo === "artwork"}
        onSelect={() => openScreen("artwork")}
      />

      {duplicateOf && <Notice>Already in your library as "{duplicateOf}".</Notice>}
      {!target.looks_launchable && (
        <Notice>{target.extension} files do not run on their own. Pick the game's executable instead.</Notice>
      )}
      {compatTools.length === 0 && <Notice>Could not read Steam's compatibility tools. Reopen the panel to retry.</Notice>}

      <div style={{ height: "6px" }} />
      <PrimaryRow
        label={busy ? "Adding…" : "Add to Steam"}
        disabled={!canAdd}
        takeFocus={returnTo === "main"}
        onSelect={onAddToSteam}
      />
      <div style={{ height: "4px" }} />

      {needsExecutableBit && (
        <ListGroup>
          <ListRow icon={<FaTerminal />} label="Mark as executable" subtitle="Steam cannot launch it otherwise." onSelect={onMakeExecutable} />
        </ListGroup>
      )}

      <PanelSectionRow>
        <TextEntry label="Name" value={name} onChange={(next) => updateDraft({ name: next })} />
      </PanelSectionRow>

      {/* Steam's text field keeps a gap below itself that nothing can turn off. */}
      <div style={{ marginTop: "-14px" }} />
      <CompactDropdown
        label="Compatibility"
        rgOptions={compatOptions}
        selectedOption={compatTool}
        onChange={(option) => updateDraft({ compatTool: option.data })}
      />
      <div style={{ height: "3px" }} />

      <ListGroup>
        <ListRow
          icon={<FaSliders />}
          label="Launch options"
          trailing={presetsOn > 0 ? `${presetsOn} on` : launchOptions.trim() ? "Set" : undefined}
          trailingNode={<FaChevronRight size={10} style={{ opacity: 0.6 }} />}
          takeFocus={returnTo === "launch"}
          onSelect={() => openScreen("launch")}
        />
      </ListGroup>
      <div style={{ height: "3px" }} />

      <CompactDropdown
        label="Collection"
        rgOptions={collectionOptions}
        selectedOption={collectionId}
        onChange={(option) => updateDraft({ collectionId: option.data as string })}
      />
      {collectionId === NEW_COLLECTION && (
        <PanelSectionRow>
          <TextEntry
            label="New collection name"
            value={newCollectionName}
            onChange={(next) => updateDraft({ newCollectionName: next })}
          />
        </PanelSectionRow>
      )}

    </Screen>
  );

  const body =
    screen === "settings" ? settingsScreen
    : target && screen === "launch" ? (
      <LaunchOptionsScreen
        options={launchOptions}
        usesProton={compatTool !== NO_COMPAT_TOOL}
        onChange={(next) => updateDraft({ launchOptions: next })}
        custom={customPresets}
        onCustomChange={setCustomPresets}
        onBack={closeScreen}
      />
    )
    : target && screen === "artwork" ? (
      <ArtworkScreen
        state={artState}
        name={name}
        path={target.path}
        title={artworkName}
        onChangeTitle={(next) => updateDraft({ artworkName: next })}
        onOpenSettings={() => openScreen("settings")}
        onBack={closeScreen}
      />
    )
    : target ? form
    : browse;

  return (
    <PanelSection>
      {/* Anchor for scrollToTop; must stay the first node in the panel. */}
      <div ref={topAnchor} />
      {body}
    </PanelSection>
  );
}

/**
 * A dropdown with its label beside it, one row high like everything around it.
 * Steam's own dropdown opens the full-screen list that a long list of Proton
 * versions needs.
 */
function CompactDropdown({
  label,
  rgOptions,
  selectedOption,
  onChange,
}: {
  label: string;
  rgOptions: DropdownOption[];
  selectedOption: string;
  onChange(option: SingleDropdownOption): void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ flex: "0 0 96px", fontSize: "13px", opacity: 0.85 }}>{label}</span>
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <Dropdown rgOptions={rgOptions} selectedOption={selectedOption} onChange={onChange} />
      </div>
    </div>
  );
}

/**
 * One line describing how the artwork download went, or "" when there is
 * nothing to say — artwork turned off, or a download not attempted yet.
 *
 * Names the files on disk, since none of them are visible in the library until
 * Steam restarts: without that, a download that worked and one that did nothing
 * read exactly the same.
 */
function describeArtwork(added: AddedShortcut): string {
  const artwork = added.artwork;
  if (!artwork) return "";
  if (!artwork.success) return `No artwork: ${artwork.error}.`;

  // Worth saying when SteamGridDB matched a different title, since that is the
  // one case where correct-looking artwork can be for the wrong game.
  const matched =
    artwork.game && artwork.game.toLowerCase() !== added.searchName.toLowerCase()
      ? ` for "${artwork.game}"`
      : "";
  return `Artwork applied${matched}: ${artwork.applied.join(", ")}.`;
}

function AddedSection({
  added,
  artworkReady,
  onUndo,
  onArtwork,
  onChangeSearchName,
}: {
  added: AddedShortcut;
  /** Artwork is switched on and has a key, so a download is worth offering. */
  artworkReady: boolean;
  onUndo(): void;
  onArtwork(): void;
  onChangeSearchName(value: string): void;
}) {
  const artworkSummary = describeArtwork(added);
  const progress = added.artworkProgress;

  // An exact match already has its artwork, so there is nothing to fix. Every
  // other state — a failure, art found under a different title, or no attempt
  // at all — is worth a try with a corrected title, which is only possible here
  // since the form is gone by now.
  const exactMatch =
    added.artwork?.success &&
    added.artwork.game.toLowerCase() === added.searchName.toLowerCase();
  const canRetryArtwork = artworkReady && !progress && !exactMatch;

  return (
    <>
      <GroupHeading>{`Added: ${added.name}`}</GroupHeading>
      {!added.verified && <Notice>Steam did not confirm this shortcut. Check your library, and add it again if it is missing.</Notice>}

      {progress && (
        <ProgressRow
          label="Artwork"
          description="Downloading from SteamGridDB."
          done={progress.done}
          total={progress.total}
          status={
            progress.slot
              ? `${progress.slot} (${progress.done + 1} of ${progress.total})`
              : "Searching SteamGridDB…"
          }
        />
      )}

      {artworkSummary && <div style={{ padding: "2px 0 6px", fontSize: "12px", opacity: 0.8 }}>{artworkSummary}</div>}
      {!artworkReady && !added.artwork && (
        <div style={{ padding: "2px 0 6px", fontSize: "12px", opacity: 0.8 }}>No artwork: set up a SteamGridDB key under Settings.</div>
      )}

      {canRetryArtwork && (
        <PanelSectionRow>
          <TextEntry label="Artwork title" value={added.searchName} onChange={onChangeSearchName} />
        </PanelSectionRow>
      )}

      <ListGroup>
        {canRetryArtwork && (
          <ListRow icon={<FaImage />} label={added.artwork ? "Try artwork again" : "Download artwork"} onSelect={onArtwork} />
        )}
        <ListRow
          icon={<FaUpRightFromSquare />}
          label="Open game page"
          trailing={added.collection}
          onSelect={() => {
            Navigation.Navigate(`/library/app/${added.appId}`);
            Navigation.CloseSideMenus();
          }}
        />
        <ListRow icon={<FaArrowRotateLeft />} label="Undo" onSelect={onUndo} />
        <ListRow icon={<FaPowerOff />} label="Restart Steam" subtitle="Only needed to show the icon." onSelect={() => restartSteam()} />
      </ListGroup>
      <div style={{ height: "10px" }} />
    </>
  );
}

function SettingsScreen({
  value,
  onChange,
  artwork,
  onChangeArtwork,
  keyStatus,
  onCheckKey,
  defaultFolder,
  onClearDefaultFolder,
  onBack,
}: {
  value: RestartPreference;
  onChange(value: RestartPreference): void;
  artwork: ArtworkSettings;
  onChangeArtwork(patch: Partial<ArtworkSettings>): void;
  /** What SteamGridDB said about the saved key, or "" before it was asked. */
  keyStatus: string;
  onCheckKey(): void;
  /** Where new entries open, or "". */
  defaultFolder: string;
  onClearDefaultFolder(): void;
  onBack(): void;
}) {
  return (
    <Screen onBack={onBack}>
      <ScreenHeader title="Settings" onBack={onBack} />

      <ListGroup>
        <ToggleRow
          icon={<FaImage />}
          label="Download artwork"
          checked={artwork.enabled}
          takeFocus
          onChange={(enabled) => onChangeArtwork({ enabled })}
        />
      </ListGroup>

      {artwork.enabled && (
        <>
          {!artwork.key.trim() && (
            <div style={{ padding: "6px 0 0", fontSize: "12px", opacity: 0.8 }}>
              SteamGridDB needs a free API key. Create one at {artwork.key_url}, then paste it below.
            </div>
          )}
          <PanelSectionRow>
            <TextEntry
              label="SteamGridDB API key"
              value={artwork.key}
              // The one field a user cannot reasonably type, so it takes a
              // paste even when the event was aimed somewhere else.
              captureGlobalPaste
              onChange={(next) => onChangeArtwork({ key: next })}
            />
          </PanelSectionRow>
          <div style={{ height: "4px" }} />
          <ListGroup>
            <ListRow icon={<FaKey />} label="Check the key" subtitle={keyStatus || undefined} onSelect={onCheckKey} />
          </ListGroup>
        </>
      )}

      <div style={{ height: "6px" }} />
      <ListGroup>
        {defaultFolder ? (
          <ListRow icon={<FaThumbtack />} label="Clear default folder" subtitle={defaultFolder} onSelect={onClearDefaultFolder} />
        ) : (
          <div style={{ padding: "0 0 6px", fontSize: "12px", opacity: 0.75 }}>
            To open a folder for every new game, go there and press X.
          </div>
        )}
      </ListGroup>
      <div style={{ height: "6px" }} />
      <CompactDropdown
        label="Restart Steam"
        rgOptions={[
          { data: "ask", label: "Ask each time" },
          { data: "always", label: "After every add" },
          { data: "never", label: "Never" },
        ]}
        selectedOption={value}
        onChange={(option) => onChange(option.data as RestartPreference)}
      />
      <div style={{ padding: "4px 0 8px", fontSize: "11px", opacity: 0.65 }}>
        Steam saves new games right away. A restart only makes the icon appear.
      </div>

      <SavedGames />
    </Screen>
  );
}

export default definePlugin(() => ({
  name: "Shortcut Forge",
  titleView: (
    <div className={staticClasses.Title} style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
      Shortcut Forge
      {/* Visible build number, so a stale install is obvious at a glance. */}
      <span style={{ fontSize: "11px", opacity: 0.5 }}>v{PLUGIN_VERSION}</span>
    </div>
  ),
  content: <Content />,
  icon: <FaHammer />,
  // Decky unmounts plugin content whenever the Quick Access panel is hidden,
  // and opening the file picker hides it. Without this the picked file lands on
  // an unmounted component and the panel reopens blank.
  alwaysRender: true,
}));
