import { DialogButton } from "@decky/ui";
import type { MouseEvent, ReactNode } from "react";
import { FaFolderOpen, FaTableCellsLarge } from "react-icons/fa6";

import type { BrowseMode } from "./store";

const STYLES = `
.sf-mode { position: relative; display: flex !important; flex-direction: row; align-items: stretch; width: 100%; min-width: 0; height: 36px; min-height: 0; padding: 3px !important; gap: 3px;
  box-sizing: border-box; border-radius: 6px; background: rgba(0,0,0,.35) !important; color: #fff !important; }
.sf-mode:focus::after, .sf-mode.gpfocus::after { content: ""; position: absolute; inset: 0; border: 2px solid #fff; border-radius: 6px; }
.sf-mode-side { flex: 1 1 0; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 6px;
  border-radius: 4px; font-size: 13px; line-height: 16px; opacity: .72; }
.sf-mode-side.sf-on { background: #1a9fff; opacity: 1; font-weight: 600; }
.sf-mode-key { padding: 0 4px; border: 1px solid currentColor; border-radius: 3px; font-size: 9px; line-height: 12px; font-weight: 600; opacity: .8; }
`;

const SIDES: { mode: BrowseMode; label: string; icon: ReactNode; key: string }[] = [
  { mode: "files", label: "Files", icon: <FaFolderOpen />, key: "L1" },
  { mode: "apps", label: "Applications", icon: <FaTableCellsLarge />, key: "R1" },
];

/**
 * Files or Applications, always visible at the top.
 *
 * One stop for the D-pad rather than two buttons: A flips it, so landing on it from
 * below can never select the wrong side. The bumpers switch from anywhere on the
 * screen, and each side can be tapped.
 */
export function ModeSwitch({ mode, onChange }: { mode: BrowseMode; onChange(mode: BrowseMode): void }) {
  const tap = (next: BrowseMode) => (event: MouseEvent) => {
    event.stopPropagation();
    onChange(next);
  };
  return (
    <>
      <style>{STYLES}</style>
      <DialogButton
        className="sf-mode"
        onClick={() => onChange(mode === "files" ? "apps" : "files")}
        onOKActionDescription={mode === "files" ? "Applications" : "Files"}
      >
        {SIDES.map((side) => (
          <div key={side.mode} className={`sf-mode-side ${side.mode === mode ? "sf-on" : ""}`} onClick={tap(side.mode)}>
            {side.icon}
            {side.label}
            {side.mode !== mode && <span className="sf-mode-key">{side.key}</span>}
          </div>
        ))}
      </DialogButton>
    </>
  );
}
