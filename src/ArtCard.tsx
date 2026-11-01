import { DialogButton, PanelSectionRow } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { FaChevronRight, FaCircleCheck, FaCircleExclamation, FaGear, FaImage } from "react-icons/fa6";

import { previewArtwork } from "./backend";
import type { ArtworkPreview, ArtworkSettings } from "./backend";
import { ListGroup, ListRow, Screen, ScreenHeader } from "./ListRow";
import { TextEntry } from "./TextEntry";

/** What the panel currently knows about a game's art, before it is added. */
export type ArtState =
  | { kind: "off" }
  | { kind: "no-key" }
  | { kind: "searching"; title: string }
  | { kind: "missing"; title: string; error: string }
  | { kind: "found"; title: string; preview: ArtworkPreview };

/** Typing a title should not search on every letter. */
const SEARCH_DELAY_MS = 600;

const cache = new Map<string, ArtworkPreview>();

/** Looks the title up as it changes, so the art is on screen before the game is added. */
export function useArtPreview(title: string, settings: ArtworkSettings): ArtState {
  const wanted = title.trim();
  const [state, setState] = useState<ArtState>({ kind: "searching", title: wanted });

  useEffect(() => {
    if (!settings.enabled) {
      setState({ kind: "off" });
      return;
    }
    if (!settings.key.trim()) {
      setState({ kind: "no-key" });
      return;
    }
    if (!wanted) {
      setState({ kind: "missing", title: "", error: "" });
      return;
    }

    const settle = (preview: ArtworkPreview) =>
      setState(
        preview.found
          ? { kind: "found", title: wanted, preview }
          : { kind: "missing", title: wanted, error: preview.error },
      );

    const cached = cache.get(wanted.toLowerCase());
    if (cached) {
      settle(cached);
      return;
    }

    setState({ kind: "searching", title: wanted });
    let current = true;
    const timer = window.setTimeout(() => {
      previewArtwork(wanted)
        .then((preview) => {
          if (preview.found) cache.set(wanted.toLowerCase(), preview);
          if (current) settle(preview);
        })
        .catch(() => {
          if (current) setState({ kind: "missing", title: wanted, error: "The plugin's backend is not responding" });
        });
    }, SEARCH_DELAY_MS);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [wanted, settings.enabled, settings.key]);

  return state;
}

function statusLine(state: ArtState, name: string): { good: boolean; text: string } {
  switch (state.kind) {
    case "off":
      return { good: false, text: "Artwork is turned off" };
    case "no-key":
      return { good: false, text: "Add a SteamGridDB key to get art" };
    case "searching":
      return { good: false, text: "Looking for art…" };
    case "missing":
      return { good: false, text: state.error || "No art found" };
    case "found": {
      const source = state.preview.official ? "Official art" : "Community art";
      const matched = state.preview.game_name;
      // A different title is the one case where the art may be for the wrong game.
      return {
        good: true,
        text: matched.toLowerCase() === name.trim().toLowerCase() ? source : `${source}: ${matched}`,
      };
    }
  }
}

const CARD_STYLES = `
.sf-card { position: relative; display: block; width: 100%; min-width: 0; height: 86px; padding: 0; overflow: hidden;
  border-radius: 6px; background: linear-gradient(135deg, #23303f, #12181f); text-align: left; }
.sf-card:focus::after, .sf-card.gpfocus::after { content: ""; position: absolute; inset: 0; border: 3px solid #fff; border-radius: 6px; }
.sf-card-hero { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: opacity 200ms; }
.sf-card-shade { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,.85) 0%, rgba(0,0,0,.1) 55%, rgba(0,0,0,0) 100%); }
.sf-card-logo { position: absolute; left: 10px; top: 8px; max-width: 58%; max-height: 54px; object-fit: contain; object-position: left center; }
.sf-card-name { position: absolute; left: 10px; right: 10px; top: 12px; font-size: 18px; font-weight: 600; color: #fff;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sf-card-status { position: absolute; left: 10px; right: 8px; bottom: 6px; display: flex; align-items: center; gap: 6px;
  font-size: 12px; line-height: 16px; color: #fff; }
.sf-card-status span { flex: 1 1 auto; min-width: 0; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@keyframes sf-pulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
.sf-card-searching { animation: sf-pulse 1.2s ease-in-out infinite; }
`;

/**
 * The game as it will look: its art, or its name until there is some, and a line
 * saying what was found. Pressing it opens the artwork screen.
 */
export function ArtCard({
  state,
  name,
  takeFocus,
  onSelect,
}: {
  state: ArtState;
  name: string;
  takeFocus?: boolean;
  onSelect(): void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!takeFocus) return;
    const frame = requestAnimationFrame(() => element.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [takeFocus]);

  const images = state.kind === "found" ? state.preview.images : {};
  const hero = images.hero && !failed[images.hero] ? images.hero : "";
  const logo = images.logo && !failed[images.logo] ? images.logo : "";
  const status = statusLine(state, name);

  const markFailed = (url: string) => setFailed((current) => ({ ...current, [url]: true }));

  return (
    <>
      <style>{CARD_STYLES}</style>
      <DialogButton ref={element} className="sf-card" onClick={onSelect} onOKActionDescription="Artwork">
        {hero && <img className="sf-card-hero" src={hero} onError={() => markFailed(hero)} />}
        <div className="sf-card-shade" />
        {logo ? (
          <img className="sf-card-logo" src={logo} onError={() => markFailed(logo)} />
        ) : (
          <div className="sf-card-name">{name}</div>
        )}
        <div className={`sf-card-status ${state.kind === "searching" ? "sf-card-searching" : ""}`}>
          {status.good ? <FaCircleCheck color="#59bf40" /> : state.kind === "searching" ? <FaImage /> : <FaCircleExclamation color="#e8b23a" />}
          <span>{status.text}</span>
          <FaChevronRight size={10} />
        </div>
      </DialogButton>
    </>
  );
}

/** The art in full, and the title it is searched under. */
export function ArtworkScreen({
  state,
  name,
  path,
  title,
  onChangeTitle,
  onOpenSettings,
  onBack,
}: {
  state: ArtState;
  name: string;
  /** The file this shortcut will run. */
  path: string;
  title: string;
  onChangeTitle(next: string): void;
  onOpenSettings(): void;
  onBack(): void;
}) {
  const images = state.kind === "found" ? state.preview.images : {};
  const status = statusLine(state, name);

  return (
    <Screen onBack={onBack}>
      <ScreenHeader title="Artwork" onBack={onBack} />
      <div
        style={{
          position: "relative",
          height: "118px",
          borderRadius: "6px",
          overflow: "hidden",
          background: "linear-gradient(135deg, #23303f, #12181f)",
        }}
      >
        {images.hero && <img src={images.hero} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
        {images.logo && (
          <img
            src={images.logo}
            style={{ position: "absolute", left: "10px", top: "10px", maxWidth: "45%", maxHeight: "70px", objectFit: "contain", objectPosition: "left top" }}
          />
        )}
        {images.grid && (
          <img
            src={images.grid}
            style={{ position: "absolute", right: "8px", top: "8px", height: "102px", borderRadius: "4px", boxShadow: "0 2px 8px rgba(0,0,0,.6)" }}
          />
        )}
      </div>
      <div style={{ padding: "6px 0", fontSize: "12px", opacity: 0.85 }}>{status.text}</div>
      <div style={{ paddingBottom: "6px", fontSize: "11px", opacity: 0.55, overflowWrap: "anywhere" }}>{path}</div>

      {state.kind === "no-key" || state.kind === "off" ? (
        <ListGroup>
          <ListRow icon={<FaGear />} label="Set up artwork in Settings" takeFocus onSelect={onOpenSettings} />
        </ListGroup>
      ) : (
        <PanelSectionRow>
          <TextEntry
            label="Search under a different title"
            value={title}
            onChange={onChangeTitle}
            description={`Leave empty to use "${name}". The shortcut keeps its name.`}
          />
        </PanelSectionRow>
      )}
    </Screen>
  );
}
