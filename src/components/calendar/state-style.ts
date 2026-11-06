import type { LifecycleState } from "@/lib/promo-calendar/types";

// Labels and CSS colour variables per lifecycle state (values live in globals.css).
export const STATE_LABEL: Record<LifecycleState, string> = {
  live: "Live",
  scheduled: "Scheduled",
  ended: "Ended",
  exhausted: "Used up",
  disabled: "Disabled",
  invalid: "Invalid",
};

const vars = (state: string): React.CSSProperties => ({
  ["--ev-accent" as string]: `var(--pp-${state})`,
  ["--ev-bg" as string]: `var(--pp-${state}-bg)`,
  ["--ev-text" as string]: `var(--pp-${state}-text)`,
});

export const STATE_VARS: Record<LifecycleState, React.CSSProperties> = {
  live: vars("live"),
  scheduled: vars("scheduled"),
  ended: vars("ended"),
  exhausted: vars("exhausted"),
  disabled: vars("disabled"),
  invalid: vars("invalid"),
};
