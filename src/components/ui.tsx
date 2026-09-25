import type { ReactNode } from "react";
import type { UrgencyKey } from "../types";
import { METRIC_LABEL, URGENCY } from "../model";

export function UrgencyBadge({ urgency }: { urgency: UrgencyKey }) {
  const u = URGENCY[urgency];
  return <span className={`badge tone-${u.tone}`}>{u.label}</span>;
}

export function MetricTag({ metric }: { metric: keyof typeof METRIC_LABEL }) {
  return <span className="metric-tag">{METRIC_LABEL[metric]}</span>;
}

export function Empty({ text }: { text: string }) {
  return <div className="empty-hint">{text}</div>;
}

export function SectionTitle({
  title,
  desc,
  extra,
}: {
  title: string;
  desc?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <h3>{title}</h3>
        {desc && <p>{desc}</p>}
      </div>
      {extra}
    </div>
  );
}
