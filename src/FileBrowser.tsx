import { ButtonItem, Field, PanelSection, PanelSectionRow } from "@decky/ui";
import { useEffect, useState } from "react";
import {
  FaArrowLeft,
  FaArrowUp,
  FaEye,
  FaEyeSlash,
  FaFile,
  FaFolder,
  FaLinux,
  FaStar,
  FaTerminal,
  FaWindows,
} from "react-icons/fa6";

import { listDirectory } from "./backend";
import type { DirectoryEntry, DirectoryListing } from "./backend";
import { DisclosureRow, ListGroup, ListRow } from "./ListRow";
import { formatBytes } from "./LocationList";

/** Rows drawn before a "Show more". A D-pad list longer than this is no use. */
const PAGE = 40;

function fileIcon(entry: DirectoryEntry) {
  if (entry.is_windows_app) return <FaWindows />;
  if (/\.(sh|run)$/i.test(entry.name)) return <FaTerminal />;
  if (entry.launchable) return <FaLinux />;
  return <FaFile />;
}

const folderTitle = (path: string) => path.split("/").filter(Boolean).pop() ?? "Filesystem root";

/** The folder's location, with the home directory shortened to "~". */
function displayPath(path: string, home: string): string {
  if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
  return path;
}

/**
 * A file browser that stays in the Quick Access panel.
 *
 * The folder is a full list of big rows, with the likely game first, so reaching
 * an executable is mostly pressing A. Only what could launch is listed; the rest
 * stays one press away, because Steam can be pointed at anything.
 */
export function FileBrowser({
  path,
  home,
  onNavigate,
  onExit,
  onPick,
  onSystemPicker,
}: {
  path: string;
  home: string;
  onNavigate(path: string): void;
  /** Back to the list of places. */
  onExit(): void;
  onPick(path: string): void;
  /** Steam's own picker, which does not need the plugin's backend. */
  onSystemPicker(): void;
}) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [failure, setFailure] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    let current = true;
    setFailure("");
    setShowOthers(false);
    setLimit(PAGE);
    listDirectory(path, showHidden)
      .then((result) => {
        if (current) setListing(result);
      })
      .catch((error) => {
        if (current) setFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      current = false;
    };
  }, [path, showHidden]);

  const shown = listing?.path === path ? listing : null;
  const entries = shown?.entries ?? [];
  const best = entries.find((entry) => entry.path === shown?.best_match);
  const folders = entries.filter((entry) => entry.is_dir);
  const files = entries.filter((entry) => entry.launchable && !entry.helper && entry !== best);
  const others = entries.filter((entry) => !entry.is_dir && (!entry.launchable || entry.helper));

  const rows = [...folders, ...files];
  const visibleRows = rows.slice(0, limit);
  // Straight out in one press, so leaving never means walking up every folder.
  // Going up a single level is the row at the top of the list.
  const goBack = onExit;

  return (
    <PanelSection title={folderTitle(path)}>
      <div style={{ padding: "0 16px 6px", fontSize: "11px", opacity: 0.6, overflowWrap: "anywhere" }}>
        {displayPath(path, home)}
      </div>

      {/* Keyed by folder so the D-pad lands on the first row of each new one. */}
      <ListGroup key={path} onBack={goBack}>
        {best && (
          <ListRow
            icon={<FaStar />}
            label={best.name}
            subtitle={`Best match · ${formatBytes(best.size)}`}
            alwaysScroll
            takeFocus
            onSelect={() => onPick(best.path)}
          />
        )}
        {shown?.parent ? (
          <ListRow
            icon={<FaArrowUp />}
            label={folderTitle(shown.parent)}
            takeFocus={!best}
            onSelect={() => onNavigate(shown.parent)}
          />
        ) : null}
        <ListRow icon={<FaArrowLeft />} label="All places" takeFocus={!best && !shown?.parent} onSelect={onExit} />

        {visibleRows.map((entry) => (
          <ListRow
            key={entry.path}
            icon={entry.is_dir ? <FaFolder /> : fileIcon(entry)}
            label={entry.name}
            trailing={entry.is_dir ? undefined : formatBytes(entry.size)}
            onSelect={() => (entry.is_dir ? onNavigate(entry.path) : onPick(entry.path))}
          />
        ))}
        {rows.length > limit && (
          <ListRow
            icon={<FaFolder />}
            label="Show more"
            trailing={`${rows.length - limit} left`}
            onSelect={() => setLimit(limit + PAGE)}
          />
        )}
      </ListGroup>

      {failure && (
        <>
          <PanelSectionRow>
            <Field description={`Could not read this folder: ${failure}`} />
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={onSystemPicker}>
              Use Steam's file picker
            </ButtonItem>
          </PanelSectionRow>
        </>
      )}
      {shown?.error && (
        <PanelSectionRow>
          <Field description={`Could not read this folder: ${shown.error}.`} />
        </PanelSectionRow>
      )}
      {shown && !shown.error && rows.length === 0 && !best && (
        <PanelSectionRow>
          <Field description={others.length > 0 ? "Nothing here looks like a game." : "This folder is empty."} />
        </PanelSectionRow>
      )}
      {shown?.truncated && (
        <PanelSectionRow>
          <Field description="This folder is very large, so not all of it is listed." />
        </PanelSectionRow>
      )}

      {others.length > 0 && (
        <div style={{ paddingTop: "6px" }}>
          <DisclosureRow
            label="Other files"
            trailing={`${others.length}`}
            expanded={showOthers}
            onToggle={() => setShowOthers(!showOthers)}
          />
        </div>
      )}
      {showOthers && (
        <ListGroup onBack={goBack}>
          {others.slice(0, limit).map((entry) => (
            <ListRow
              key={entry.path}
              icon={fileIcon(entry)}
              label={entry.name}
              trailing={formatBytes(entry.size)}
              onSelect={() => onPick(entry.path)}
            />
          ))}
          {others.length > limit && (
            <ListRow
              icon={<FaFile />}
              label="Show more"
              trailing={`${others.length - limit} left`}
              onSelect={() => setLimit(limit + PAGE)}
            />
          )}
        </ListGroup>
      )}

      <div style={{ paddingTop: "6px" }}>
        <ListGroup onBack={goBack}>
          <ListRow
            icon={showHidden ? <FaEyeSlash /> : <FaEye />}
            label={showHidden ? "Hide hidden files" : "Show hidden files"}
            onSelect={() => setShowHidden(!showHidden)}
          />
        </ListGroup>
      </div>
    </PanelSection>
  );
}
