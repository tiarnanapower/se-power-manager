import { STATE_LABEL } from "@/components/calendar/state-style";
import type { LifecycleState } from "@/lib/promo-calendar/types";

export function StatePill({ state }: { state: LifecycleState }) {
  return <span className={`pp-pill pp-pill--${state}`}>{STATE_LABEL[state]}</span>;
}
