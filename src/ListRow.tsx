import { DialogButton, Focusable, GamepadButton } from "@decky/ui";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FaChevronDown, FaChevronLeft, FaChevronRight, FaTriangleExclamation } from "react-icons/fa6";

export interface ListRowProps {
  /** Left out on rows in a long list of the same thing, where it would only be noise. */
  icon?: ReactNode;
  label: string;
  /** Right-aligned secondary text: free space, app source, and so on. */
  trailing?: string;
  /** Something other than text at the end of the row. */
  trailingNode?: ReactNode;
  /** A smaller line under the label. */
  subtitle?: string;
  /**
   * Scroll a label too long for the row even when the row is not selected. For
   * the row that matters most in its list; others scroll only while selected.
   */
  alwaysScroll?: boolean;
  /**
   * Take gamepad focus when this row appears.
   *
   * For a row that arrives in response to a press, so the D-pad carries on from
   * what the press produced rather than from wherever the pressed row went.
   */
  takeFocus?: boolean;
  /** What X does on this row, named in Steam's button legend at the bottom. */
  secondaryLabel?: string;
  onSecondary?(): void;
  onSelect(): void;
}

/**
 * A long label slides to its end and back, pausing at each end to be read.
 *
 * `:focus` and `.gpfocus` for the same reason as the source tabs: gamepad
 * navigation moves real DOM focus, and the class name is not ours to depend on.
 */
const MARQUEE_STYLES = `
@keyframes sf-marquee {
  0%, 8% { transform: translateX(0); }
  92%, 100% { transform: translateX(var(--sf-shift)); }
}
.sf-label-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sf-scrolls.sf-always .sf-label-text,
.sf-row:focus .sf-scrolls .sf-label-text,
.sf-row.gpfocus .sf-scrolls .sf-label-text {
  display: inline-block;
  overflow: visible;
  animation: sf-marquee var(--sf-duration) linear infinite alternate;
}
`;

/** Pixels per second. */
const MARQUEE_SPEED = 80;
/** Share of the animation spent moving, the rest being the pauses in the keyframes. */
const MARQUEE_MOVING = 0.84;

function RowLabel({ text, always }: { text: string; always?: boolean }) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  // Remeasured on resize, since the panel lays out at zero width while hidden.
  // The observer comes from the panel's own window: see DEVELOPMENT.md on `window`.
  useEffect(() => {
    const box = outer.current;
    const content = inner.current;
    if (!box || !content) return;
    const measure = () => setOverflow(Math.max(0, content.scrollWidth - box.clientWidth));
    measure();
    const Observer = box.ownerDocument.defaultView?.ResizeObserver;
    if (!Observer) return;
    const observer = new Observer(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [text]);

  const scrolls = overflow > 0;
  return (
    <span
      ref={outer}
      className={`${scrolls ? "sf-scrolls" : ""} ${always ? "sf-always" : ""}`}
      style={{ display: "block", overflow: "hidden", minWidth: 0 }}
    >
      <span
        ref={inner}
        className="sf-label-text"
        style={
          {
            "--sf-shift": `-${overflow}px`,
            "--sf-duration": `${Math.max(1, overflow / MARQUEE_SPEED) / MARQUEE_MOVING}s`,
          } as CSSProperties
        }
      >
        {text}
      </span>
    </span>
  );
}

/**
 * One selectable row.
 *
 * Rows are deliberately full width and a single line: in the Quick Access
 * panel that makes them large D-pad targets, and keeps a long list scannable
 * without a trackpad.
 */
export function ListRow({
  icon,
  label,
  trailing,
  trailingNode,
  subtitle,
  alwaysScroll,
  takeFocus,
  secondaryLabel,
  onSecondary,
  onSelect,
}: ListRowProps) {
  const element = useRef<HTMLDivElement>(null);

  // Steam moves gamepad focus by focusing the real element, so this is the
  // whole of handing the D-pad to a row. A frame late: the row is not laid out
  // until after the commit that mounted it has painted, and focus given to an
  // unlaid-out element is focus Steam's navigation immediately takes back.
  useEffect(() => {
    if (!takeFocus) return;
    const frame = requestAnimationFrame(() => element.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [takeFocus]);

  return (
    <DialogButton
      ref={element}
      className="sf-row"
      onClick={onSelect}
      onSecondaryButton={onSecondary}
      onSecondaryActionDescription={secondaryLabel}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        // Tighter than a default DialogButton so a full list fits on screen,
        // but still a comfortable controller target.
        padding: "8px 12px",
        minHeight: "0",
        width: "100%",
        minWidth: "0",
        fontSize: "14px",
        lineHeight: "1.2",
        textAlign: "left",
      }}
    >
      {icon && (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            width: "20px",
            height: "20px",
            fontSize: "15px",
            opacity: 0.85,
          }}
        >
          {icon}
        </span>
      )}
      <span
        style={{
          flex: "1 1 auto",
          minWidth: 0,
        }}
      >
        <RowLabel text={label} always={alwaysScroll} />
        {subtitle && <div style={{ fontSize: "11px", opacity: 0.65, marginTop: "2px" }}>{subtitle}</div>}
      </span>
      {trailing && <span style={{ flexShrink: 0, opacity: 0.6, fontSize: "11px" }}>{trailing}</span>}
      {trailingNode}
    </DialogButton>
  );
}

/**
 * Vertical group of rows.
 *
 * `flow-children="vertical"` keeps up/down moving between rows instead of
 * escaping the group, which is what makes these lists usable in Game Mode.
 */
export function ListGroup({ children, onBack }: { children: ReactNode; onBack?(): void }) {
  return (
    <Focusable
      flow-children="vertical"
      onCancelButton={onBack}
      onCancelActionDescription={onBack ? "Back" : undefined}
      style={{ display: "flex", flexDirection: "column", gap: "3px" }}
    >
      <style>{MARQUEE_STYLES}</style>
      {children}
    </Focusable>
  );
}

/**
 * Row that expands or collapses the list below it.
 *
 * Built from `ListRow` so it sits in the same visual language as the rows it
 * reveals, and the chevron says which way pressing A will go.
 */
export function DisclosureRow({
  label,
  expanded,
  trailing,
  onToggle,
}: {
  label: string;
  expanded: boolean;
  trailing?: string;
  onToggle(): void;
}) {
  return (
    <ListGroup>
      <ListRow
        icon={expanded ? <FaChevronDown /> : <FaChevronRight />}
        label={label}
        trailing={trailing}
        onSelect={onToggle}
      />
    </ListGroup>
  );
}

const CONTROL_STYLES = `
.sf-switch { position: relative; flex-shrink: 0; width: 28px; height: 16px; border-radius: 8px;
  border: 1.5px solid currentColor; box-sizing: border-box; opacity: .55; transition: opacity 120ms; }
.sf-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 9px; height: 9px; border-radius: 50%;
  background: currentColor; transition: transform 120ms; }
.sf-switch.sf-on { opacity: 1; background: #1a9fff; border-color: #1a9fff; }
.sf-switch.sf-on::after { transform: translateX(12px); background: #fff; }
.sf-primary { width: 100%; min-width: 0; height: 40px; min-height: 0; padding: 0 12px; font-size: 15px; font-weight: 600; }
.sf-primary:not(:focus):not(.gpfocus):not([disabled]) { background: #1a9fff; color: #fff; }
`;

/** A row with a switch at its end. Same height as every other row, so lists scroll evenly. */
export function ToggleRow({
  checked,
  onChange,
  onFocused,
  ...row
}: Omit<ListRowProps, "onSelect" | "trailing" | "subtitle"> & {
  checked: boolean;
  onChange(next: boolean): void;
  onFocused?(): void;
}) {
  return (
    <div onFocus={onFocused}>
      <style>{CONTROL_STYLES}</style>
      <ListRow
        {...row}
        trailingNode={<span className={`sf-switch ${checked ? "sf-on" : ""}`} />}
        onSelect={() => onChange(!checked)}
      />
    </div>
  );
}

/** The one thing a screen is for. */
export function PrimaryRow({
  label,
  disabled,
  takeFocus,
  onSelect,
}: {
  label: string;
  disabled?: boolean;
  takeFocus?: boolean;
  onSelect(): void;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!takeFocus) return;
    const frame = requestAnimationFrame(() => element.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [takeFocus]);
  return (
    <>
      <style>{CONTROL_STYLES}</style>
      <DialogButton ref={element} className="sf-primary" disabled={disabled} onClick={onSelect}>
        {label}
      </DialogButton>
    </>
  );
}

export function GroupHeading({ children }: { children: string }) {
  return (
    <div
      style={{
        padding: "10px 0 3px",
        fontSize: "11px",
        lineHeight: "14px",
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        opacity: 0.6,
      }}
    >
      {children}
    </div>
  );
}

const SCROLLER_STYLES = `
.sf-scroller { overflow-y: auto; scroll-behavior: smooth; padding: 6px 0; box-sizing: border-box;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%); }
.sf-scroller::-webkit-scrollbar { display: none; }
`;

/**
 * A list that scrolls inside a fixed box, so moving down never shifts what is around it.
 *
 * The selected row stays centred, so every press moves the list by one row. Left to
 * Steam it sits still for a press, then lurches by two.
 */
export function ListScroller({ height, children }: { height: number; children: ReactNode }) {
  return (
    <div
      className="sf-scroller"
      style={{ height: `${height}px` }}
      onFocus={(event) =>
        (event.target as HTMLElement).closest(".sf-row")?.scrollIntoView({ block: "center", behavior: "smooth" })
      }
    >
      <style>{SCROLLER_STYLES}</style>
      {children}
    </div>
  );
}

/**
 * One screen of the panel. B means "back one step" from anywhere on it, which only
 * works from the root: a handler on a single row is lost as soon as focus moves off
 * it, and B then leaves the plugin altogether.
 */
export function Screen({
  onBack,
  secondaryLabel,
  onSecondary,
  onBumper,
  children,
}: {
  onBack?(): void;
  /** L1 or R1, anywhere on this screen. */
  onBumper?(side: "left" | "right"): void;
  /** What X does anywhere on this screen, named in Steam's button legend. */
  secondaryLabel?: string;
  onSecondary?(): void;
  children: ReactNode;
}) {
  return (
    <Focusable
      onCancelButton={onBack}
      onCancelActionDescription={onBack ? "Back" : undefined}
      onSecondaryButton={onSecondary}
      onSecondaryActionDescription={secondaryLabel}
      onButtonDown={(event) => {
        if (event.detail.button === GamepadButton.BUMPER_LEFT) onBumper?.("left");
        if (event.detail.button === GamepadButton.BUMPER_RIGHT) onBumper?.("right");
      }}
      style={{ display: "flex", flexDirection: "column" }}
    >
      {children}
    </Focusable>
  );
}

/** A screen's title. Tappable, since the touchscreen has no B button. */
export function ScreenHeader({
  title,
  trailing,
  onBack,
}: {
  title: string;
  trailing?: string;
  onBack(): void;
}) {
  return (
    <div
      onClick={onBack}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        height: "24px",
        marginBottom: "4px",
        fontSize: "14px",
        fontWeight: 600,
      }}
    >
      <FaChevronLeft size={12} style={{ opacity: 0.7 }} />
      <span style={{ flex: "1 1 auto" }}>{title}</span>
      {trailing && <span style={{ fontSize: "12px", fontWeight: 400, opacity: 0.7 }}>{trailing}</span>}
    </div>
  );
}

/** A short warning that takes up as little of the screen as it can. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "6px", alignItems: "baseline", padding: "4px 0", fontSize: "12px", lineHeight: "15px", color: "#e8b23a" }}>
      <FaTriangleExclamation size={11} style={{ flexShrink: 0 }} />
      <span>{children}</span>
    </div>
  );
}
