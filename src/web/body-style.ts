import type { CSSProperties } from "react";

export const BODY_STYLE = {
  fontFamily: "'Inter', sans-serif",
  fontFeatureSettings: "'liga' 1, 'calt' 1",
} as const satisfies CSSProperties;
