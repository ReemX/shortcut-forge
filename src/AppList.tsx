import { PanelSectionRow } from "@decky/ui";
import { useEffect, useMemo, useState } from "react";
import { FaChevronDown, FaChevronRight, FaCube } from "react-icons/fa6";

import { applicationTag, matchesQuery, savedShortcutFor, splitApplications } from "./applications";
import type { Application, SavedShortcut } from "./backend";
import { GroupHeading, ListGroup, ListRow, ListScroller } from "./ListRow";
import { TextEntry } from "./TextEntry";

/** Fits the panel under the mode switch and search, with Settings still on screen. */
const LIST_HEIGHT = 222;

const message = (text: string) => <div style={{ padding: "10px 0", fontSize: "12px", opacity: 0.7 }}>{text}</div>;

/**
 * Installed applications, as the other way to choose what to add.
 *
 * The list scrolls inside a fixed box like the launch presets, so search stays in
 * reach and every press moves it by one row.
 */
export function AppList({
  applications,
  failed,
  saved,
  query,
  showSystem,
  returnTo,
  takeFocus,
  onQuery,
  onToggleSystem,
  onPick,
}: {
  /** null until the backend has answered. */
  applications: Application[] | null;
  failed: boolean;
  saved: SavedShortcut[];
  query: string;
  showSystem: boolean;
  /** The application the form just came back from, whose row gets focus again. */
  returnTo: string;
  /** Give the list focus when it appears. */
  takeFocus: boolean;
  onQuery(query: string): void;
  onToggleSystem(): void;
  onPick(application: Application): void;
}) {
  const searching = query.trim().length > 0;
  const groups = useMemo(() => splitApplications(applications ?? []), [applications]);
  const results = useMemo(
    () => (searching ? (applications ?? []).filter((application) => matchesQuery(application, query)) : []),
    [applications, query, searching],
  );

  // With nothing of your own installed, an empty list above a closed group would
  // look like nothing was found at all.
  const systemOpen = showSystem || groups.own.length === 0;
  const first = (searching ? results : groups.own.length > 0 ? groups.own : groups.system)[0];

  // Focus is handed over once, when the list arrives. Rows come and go as you type,
  // and one reappearing must not pull focus out of the search field.
  const [focusKey, setFocusKey] = useState("");
  const ready = applications !== null;
  useEffect(() => {
    if (!ready || !takeFocus) return;
    setFocusKey(returnTo || first?.desktop_file || "");
    const timer = setTimeout(() => setFocusKey(""), 200);
    return () => clearTimeout(timer);
  }, [ready]);

  const row = (application: Application) => {
    const shortcut = savedShortcutFor(application, saved);
    return (
      <ListRow
        key={application.desktop_file}
        icon={
          application.icon_data ? (
            <img src={application.icon_data} alt="" style={{ width: "20px", height: "20px", objectFit: "contain" }} />
          ) : (
            <FaCube />
          )
        }
        label={application.name}
        trailing={applicationTag(application, Boolean(shortcut))}
        takeFocus={application.desktop_file === focusKey}
        onSelect={() => onPick(application)}
      />
    );
  };

  return (
    <>
      <PanelSectionRow>
        <TextEntry label="Search" value={query} onChange={onQuery} />
      </PanelSectionRow>
      {/* Steam's text field keeps a gap below itself that nothing can turn off. */}
      <div style={{ marginTop: "-14px" }} />

      <ListScroller height={LIST_HEIGHT}>
        {failed && message("Could not read the installed applications. Reopen the panel to try again.")}
        {!failed && !ready && message("Looking for installed applications…")}

        {searching ? (
          results.length > 0 ? (
            <ListGroup>{results.map(row)}</ListGroup>
          ) : (
            message(`Nothing matches "${query.trim()}".`)
          )
        ) : (
          <>
            {groups.own.length > 0 && <ListGroup>{groups.own.map(row)}</ListGroup>}
            {groups.system.length > 0 && (
              <>
                {groups.own.length > 0 ? (
                  <div style={{ paddingTop: "6px" }}>
                    <ListGroup>
                      <ListRow
                        icon={systemOpen ? <FaChevronDown /> : <FaChevronRight />}
                        label="System apps"
                        trailing={`${groups.system.length}`}
                        onSelect={onToggleSystem}
                      />
                    </ListGroup>
                  </div>
                ) : (
                  <GroupHeading>System apps</GroupHeading>
                )}
                {systemOpen && (
                  <div style={{ paddingTop: "3px" }}>
                    <ListGroup>{groups.system.map(row)}</ListGroup>
                  </div>
                )}
              </>
            )}
            {ready && applications.length === 0 && message("No installed applications found.")}
          </>
        )}
      </ListScroller>
    </>
  );
}
