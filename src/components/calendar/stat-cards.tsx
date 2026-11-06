import { AlertIcon, CalendarIcon, PulseIcon, TagIcon } from "@/components/shell/icons";

export interface Stat {
  label: string;
  value: number;
  hint: string;
  tone: "blue" | "violet" | "amber" | "red" | "slate";
  icon: "live" | "scheduled" | "alert" | "gap";
}

const ICON = { live: PulseIcon, scheduled: CalendarIcon, alert: AlertIcon, gap: TagIcon };

export function StatCards({ stats }: { stats: Stat[] }) {
  return (
    <div className="pp-stats" role="list" aria-label="Summary">
      {stats.map((stat) => {
        const Icon = ICON[stat.icon];

        return (
          <div key={stat.label} className={`pp-stat pp-stat--${stat.tone}`} role="listitem">
            <span className="pp-stat__icon"><Icon size={20} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="pp-stat__value">{stat.value}</div>
              <div className="pp-stat__label">{stat.label}</div>
              <div className="pp-stat__hint">{stat.hint}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
