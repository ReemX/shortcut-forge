import { DialogButton, Focusable } from "@decky/ui";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FaChevronDown, FaChevronRight } from "react-icons/fa6";

export interface ListRowProps {
  icon: ReactNode;
  label: string;
  /** Right-aligned secondary text: free space, app source, and so on. */
  trailing?: string;
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
export function ListRow({ icon, label, trailing, subtitle, alwaysScroll, takeFocus, onSelect }: ListRowProps) {
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
      style={{ display: "flex", flexDirection: "column", gap: "3px", padding: "0 16px" }}
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
