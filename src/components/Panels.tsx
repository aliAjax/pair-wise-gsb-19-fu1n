import type { DeskState, Tank } from "../types";
import {
  METRICS,
  METRIC_LABEL,
  formatTime,
  formatValue,
  isOverLimit,
  latestMetric,
  shiftLabel,
  tankById,
} from "../model";
import { Empty } from "./ui";

export function ReadingsLog({
  state,
  tankId,
  onSelectTank,
}: {
  state: DeskState;
  tankId: string | null;
  onSelectTank?: (id: string) => void;
}) {
  const readings = [...state.readings]
    .filter((r) => (tankId ? r.tankId === tankId : true))
    .sort((a, b) => b.at - a.at);

  if (readings.length === 0) return <Empty text="还没有检测记录" />;

  return (
    <div className="reading-log">
      {readings.map((r) => {
        const tank = tankById(state, r.tankId);
        return (
          <article key={r.id} className="reading-row">
            <div className="reading-time">
              <strong>{formatTime(r.at)}</strong>
              <span>{shiftLabel(state, r.shiftId)} · {r.clerk}</span>
              {onSelectTank && tank && (
                <button className="link-btn" onClick={() => onSelectTank(tank.id)}>
                  {tank.name}
                </button>
              )}
            </div>
            <div className="reading-values">
              {METRICS.filter((m) => r[m.key] !== undefined).map((m) => {
                const over = tank ? isOverLimit(tank, m.key, r[m.key] as number) : false;
                return (
                  <span key={m.key} className={`rv-pill ${over ? "over" : "ok"}`}>
                    {m.label} {formatValue(m.key, r[m.key] as number)}
                    {m.unit ? ` ${m.unit}` : ""}
                  </span>
                );
              })}
            </div>
            {r.note && <p className="reading-note">{r.note}</p>}
          </article>
        );
      })}
    </div>
  );
}

export function TankOverview({
  state,
  selectedTank,
  onSelectTank,
}: {
  state: DeskState;
  selectedTank: string | null;
  onSelectTank: (id: string) => void;
}) {
  return (
    <div className="tank-grid">
      {state.tanks.map((tank) => (
        <TankCard
          key={tank.id}
          state={state}
          tank={tank}
          active={selectedTank === tank.id}
          onSelect={() => onSelectTank(tank.id)}
        />
      ))}
    </div>
  );
}

function TankCard({
  state,
  tank,
  active,
  onSelect,
}: {
  state: DeskState;
  tank: Tank;
  active: boolean;
  onSelect: () => void;
}) {
  const openCount = state.issues.filter(
    (i) => i.tankId === tank.id && i.status === "open"
  ).length;
  const activeTask = state.tasks.find((t) => t.tankId === tank.id && t.status !== "done");

  return (
    <button className={`tank-card ${active ? "active" : ""} ${openCount > 0 ? "has-issue" : ""}`} onClick={onSelect}>
      <div className="tank-card-head">
        <strong>{tank.name}</strong>
        {openCount > 0 && <span className="dot-danger">{openCount} 项待处理</span>}
      </div>
      <div className="tank-metrics">
        {METRICS.map((m) => {
          const latest = latestMetric(state, tank.id, m.key);
          return (
            <div key={m.key} className={`tm ${latest?.over ? "over" : ""}`}>
              <span>{m.label}</span>
              <strong>
                {latest ? `${formatValue(m.key, latest.value)}${m.unit ? m.unit : ""}` : "—"}
              </strong>
            </div>
          );
        })}
      </div>
      <div className="tank-foot">
        <span>
          {activeTask
            ? activeTask.status === "scheduled"
              ? `换水 ${activeTask.slot}`
              : "换水待排"
            : "今晚无换水安排"}
        </span>
      </div>
    </button>
  );
}
