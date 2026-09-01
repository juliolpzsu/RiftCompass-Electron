// The main window is frameless (frame: false, see electron/windows.ts)
// so the app's own 40px header reaches the very top of the window — these
// are the min/max/close buttons that replace the native ones.
//
// Known trade-off, accepted deliberately: custom buttons don't get
// Windows 11's Snap Layouts flyout on hover of the maximize button.
// Dragging to screen edges and Win+arrow/Win+Z snapping still work, so
// the min-size Snap fix (electron/windows.ts's minWidth/minHeight) still
// matters.
//
// Styling follows the native Windows 11 caption controls (46px-wide flat
// buttons, thin 1px-stroke glyphs) so they feel OS-native, with one brand
// touch: close hovers rose (--rose token) instead of Windows red.
import { useEffect, useState } from "react";
import { COLORS } from "./theme";

function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

// Windows 11's "restore down" glyph: front square over a back one.
function RestoreIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M2.5 2.5 V1.5 A1 1 0 0 1 3.5 0.5 H8.5 A1 1 0 0 1 9.5 1.5 V6.5 A1 1 0 0 1 8.5 7.5 H7.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="0.5" y="2.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1" />
      <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

const HAS_WINDOW_CHROME = typeof window !== "undefined" && !!window.riftcompassWindow;

export function WindowControls() {
  const [maximized, setMaximized] = useState(true); // window opens maximized (electron/windows.ts)
  const [hovered, setHovered] = useState<"min" | "max" | "close" | null>(null);

  useEffect(() => {
    if (!HAS_WINDOW_CHROME) return;
    const win = window.riftcompassWindow!;
    win.isMaximized().then(setMaximized).catch(() => {});
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized).catch(() => {});
    });
    return unlisten;
  }, []);

  // In a plain browser (npm run dev without Electron) there is no window
  // chrome to control — render nothing instead of dead buttons.
  if (!HAS_WINDOW_CHROME) return null;

  const win = window.riftcompassWindow!;
  const baseStyle = (key: "min" | "max" | "close"): React.CSSProperties => ({
    width: 46,
    height: "100%",
    border: "none",
    padding: 0,
    display: "grid",
    placeItems: "center",
    background:
      hovered === key ? (key === "close" ? COLORS.rose : "rgba(255,255,255,0.07)") : "transparent",
    color: hovered === key ? COLORS.text : COLORS.muted,
    transition: "background 80ms linear, color 80ms linear",
    WebkitAppRegion: "no-drag",
  });

  return (
    <div style={{ display: "flex", height: "100%", flexShrink: 0, WebkitAppRegion: "no-drag" }}>
      <button
        aria-label="Minimize"
        style={baseStyle("min")}
        onMouseEnter={() => setHovered("min")}
        onMouseLeave={() => setHovered(null)}
        onClick={() => win.minimize()}
      >
        <MinimizeIcon />
      </button>
      <button
        aria-label={maximized ? "Restore" : "Maximize"}
        style={baseStyle("max")}
        onMouseEnter={() => setHovered("max")}
        onMouseLeave={() => setHovered(null)}
        onClick={() => win.toggleMaximize()}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button
        aria-label="Close"
        style={baseStyle("close")}
        onMouseEnter={() => setHovered("close")}
        onMouseLeave={() => setHovered(null)}
        onClick={() => win.close()}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
