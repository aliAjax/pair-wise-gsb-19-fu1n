import { useState } from "react";
import type { DeskState, WaterTask } from "../types";
import {
  SLOTS,
  URGENCY,
  availableSlots,
  formatTime,
  queueBlockReason,
  shiftLabel,
  tankById,
} from "../model";
import { Empty, SectionTitle, UrgencyBadge } from "./ui";

interface Props {
  state: DeskState;
  onAuto: () => void;
  onAssign: (taskId: string, slot: string) => void;
  onClear: (taskId: string) => void;
  onComplete: (taskId: string) => void;
  onRemove: (taskId: string) => void;
  onRoutine: (tankId: string, reason: string) => void;
  allowActions: boolean;
}

function TaskRow({
  state,
  task,
  onAssign,
  onClear,
  onComplete,
  onRemove,
  allowActions,
}: {
  state: DeskState;
  task: WaterTask;
} & Pick<Props, "onAssign" | "onClear" | "onComplete" | "onRemove" | "allowActions">) {
  const tank = tankById(state, task.tankId);
  const activeShiftId = state.shifts.find((s) => s.active)?.id;
  const handedOver = task.status !== "done" && task.ownerShiftId !== activeShiftId;
  const block = queueBlockReason(state, task);
  const slots = availableSlots(state);

  return (
    <article className={`task-row status-${task.status}`}>
      <div className="task-main">
        <div className="task-title">
          <strong>{tank?.name ?? "已删鱼缸"}</strong>
          <UrgencyBadge urgency={task.urgency} />
          {task.status === "queued" && <span className="badge tone-warn">待排</span>}
          {task.status === "scheduled" && <span className="badge tone-info">已排 {task.slot}</span>}
          {task.status === "done" && <span className="badge tone-muted">已换水</span>}
        </div>
        <p className="task-reason">{task.reason}</p>
        <div className="task-meta">
          <span>登记 {formatTime(task.createdAt)} · {shiftLabel(state, task.createdShiftId)}</span>
          {handedOver && <span className="owner-tag">交班后现归 {shiftLabel(state, task.ownerShiftId)}</span>}
          {task.completedAt && <span>完成于 {formatTime(task.completedAt)}</span>}
        </div>
        {task.status === "queued" && block && <p className="block-reason">⛔ {block}</p>}
      </div>
      {allowActions && (
        <div className="task-actions">
          {task.status === "queued" && (
            <>
              <select
                value=""
                disabled={slots.length === 0}
                onChange={(e) => e.target.value && onAssign(task.id, e.target.value)}
              >
                <option value="">选时段…</option>
                {slots.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button className="small-btn outline" onClick={() => onRemove(task.id)}>
                移出队列
              </button>
            </>
          )}
          {task.status === "scheduled" && (
            <>
              <button className="small-btn primary" onClick={() => onComplete(task.id)}>
                完成换水
              </button>
              <button className="small-btn outline" onClick={() => onClear(task.id)}>
                撤回待排
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

export function WaterBoard({
  state,
  onAuto,
  onAssign,
  onClear,
  onComplete,
  onRemove,
  onRoutine,
  allowActions,
}: Props) {
  const [tankId, setTankId] = useState(state.tanks[0]?.id ?? "");
  const [reason, setReason] = useState("");

  const scheduled = state.tasks
    .filter((t) => t.status === "scheduled")
    .sort((a, b) => (a.slot && b.slot ? a.slot.localeCompare(b.slot) : 0));
  const done = state.tasks
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const queued = state.tasks
    .filter((t) => t.status === "queued")
    .sort(
      (a, b) =>
        URGENCY[a.urgency].rank - URGENCY[b.urgency].rank || a.createdAt - b.createdAt
    );

  const occupied = new Map<string, string>();
  scheduled.forEach((t) => t.slot && occupied.set(t.slot, t.id));

  return (
    <div className="water-board">
      <div className="timeline panel">
        <SectionTitle
          title="当晚换水队列"
          desc="按紧急程度排入时段；一个鱼缸占一个时段，冲突项停在待排"
          extra={
            allowActions ? (
              <button className="primary-action" onClick={onAuto} disabled={queued.length === 0}>
                一键按紧急程度排期
              </button>
            ) : undefined
          }
        />
        <div className="slot-grid">
          {SLOTS.map((slot) => {
            const taskId = occupied.get(slot);
            const task = taskId ? state.tasks.find((t) => t.id === taskId) : undefined;
            const tank = task ? tankById(state, task.tankId) : undefined;
            return (
              <div key={slot} className={`slot-cell ${task ? "filled" : ""}`}>
                <span className="slot-time">{slot}</span>
                {task && tank ? (
                  <div className="slot-body">
                    <strong>{tank.name}</strong>
                    <em>{task.reason}</em>
                    <UrgencyBadge urgency={task.urgency} />
                  </div>
                ) : (
                  <span className="slot-empty">空闲</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <section className="panel">
        <SectionTitle title="待排换水" desc={`${queued.length} 项等待排入空闲时段`} />
        {queued.length === 0 ? (
          <Empty text="没有待排换水项" />
        ) : (
          <div className="card-list">
            {queued.map((task) => (
              <TaskRow
                key={task.id}
                state={state}
                task={task}
                onAssign={onAssign}
                onClear={onClear}
                onComplete={onComplete}
                onRemove={onRemove}
                allowActions={allowActions}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <SectionTitle title="已排期 / 已完成" />
        {scheduled.length === 0 && done.length === 0 ? (
          <Empty text="今晚尚未排定换水" />
        ) : (
          <div className="card-list">
            {[...scheduled, ...done].map((task) => (
              <TaskRow
                key={task.id}
                state={state}
                task={task}
                onAssign={onAssign}
                onClear={onClear}
                onComplete={onComplete}
                onRemove={onRemove}
                allowActions={allowActions}
              />
            ))}
          </div>
        )}
      </section>

      {allowActions && (
        <section className="panel routine-box">
          <SectionTitle title="登记计划换水" desc="不依赖异常项的常规换水，紧急程度为计划换水" />
          <div className="routine-form">
            <select value={tankId} onChange={(e) => setTankId(e.target.value)}>
              {state.tanks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <input
              placeholder="原因，如：周换水 1/3"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button
              className="small-btn outline"
              onClick={() => {
                onRoutine(tankId, reason);
                setReason("");
              }}
            >
              加入待排
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
