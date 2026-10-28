// The look of the screens, the HUD and the overlays: the browser build's
// css/main.css (a light paper theme), rewritten class-based in
// tools/ui-style.css and converted with `starhermit css` into
// assets/ui-style.json (`npm run css`), registered at start with the theme the
// runtime's own widgets (scroll bars, focus rings, selects, text fields) take.
// The runtime's high contrast option is the old body.high-contrast tokens.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string>;
const BASE: Tokens = {
  accent: "#2f6fed", ink: "#1c2733", "ink-soft": "#4a5a6a", paper: "#f4f6f8", panel: "#ffffffdb", "panel-border": "#1c273324",
  danger: "#b3372f", ok: "#1c7a3d", gold: "#c98a00", white: "#ffffff",
};
const CONTRAST: Tokens = { panel: "#ffffff", "panel-border": "#1c2733", ink: "#000000", "ink-soft": "#222222", accent: "#0037c8" };
let current: Tokens = { ...BASE };
let key = "";
export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setFont({ family: "system-ui" });
  ui.setTheme({
    fontSize: 16, smallSize: 13.6, headingSize: 25.6, padding: 8, spacing: 8, radius: 12,
    text: BASE.ink!, muted: BASE["ink-soft"]!, panel: "#ffffff", control: "#ffffff", hovered: "#eef2f6",
    pressed: "#dde5ee", field: "#ffffff", accent: BASE.accent!, focus: BASE.accent!, outline: "#1c273340",
  });
  ui.setTokens(css.tokens);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    heading: { text: { color: "$ink" } },
    widget: { focusRing: { color: "$accent", width: 3, offset: 2 } },
    scrollArea: { parts: { bar: { background: "$ink-soft", radius: 4 } } },
    tooltip: { background: "#1c2733", text: { color: "#ffffff" }, radius: 6, padding: 6 },
    // .modal: rgba(28, 39, 51, 0.45) behind the card
    dialog: { background: "#00000000", padding: 0, parts: { backdrop: { background: "#1c273373" } } },
  });
  key = "";
  applyTokens(false);
}
export function applyTokens(highContrast: boolean): void {
  const k = String(highContrast);
  if (k === key) return;
  key = k;
  current = { ...BASE, ...(highContrast ? CONTRAST : {}) };
  ui.setTokens(current);
  ui.setTheme({ text: current.ink!, muted: current["ink-soft"]!, accent: current.accent!, focus: current.accent! });
}
export function token(name: string): string { return current[name] ?? "#000000"; }
