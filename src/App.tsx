import { useEffect, useMemo, useState } from "react";
import {
  METRICS,
  METRIC_ORDER,
  SHIFT_CYCLE,
  SLOTS,
  cancelWaterTask,
  completeWaterTask,
  fmtTime,
  fmtValue,
  handover,
  ingestReading,
  isOverLimit,
  nextShiftLabel,
  queueManualWater,
  queueWaterForIssue,
  resolveIssue,
  urgencyLabel,
} from "./domain";
import { loadState, resetState, saveState } from "./storage";
import type {
  AppState,
  FilterTab,
  MetricKey,
  Reading,
  Tank,
  WaterChangeTask,
  WaterIssue,
} from "./types";
import "./styles.css";

const TABS: { id: FilterTab; label: string }[] = [
  { id: "pending", label: "待处理" },
  { id: "water", label: "换水" },
  { id: "done", label: "已完成" },
  { id: "all", label: "全部" },
];

type Toast = { id: number; text: string; kind: "ok" | "warn" };

function badgeClass(score: number): string {
  if (score >= 200) return "tag tag-danger";
  if (score >= 50) return "tag tag-warn";
  return "tag tag-ok";
}

function statusTag(status: WaterChangeTask["status"]) {
  switch (status) {
    case "queued":
      return { text: "已排时段", cls: "tag tag-ok" };
    case "pending_schedule":
      return { text: "待排", cls: "tag tag-danger" };
    case "done":
      return { text: "已完成", cls: "tag tag-muted" };
    case "cancelled":
      return { text: "已撤销", cls: "tag tag-muted" };
  }
}

/* ---------------------------------------------------------------- */

function ShiftBar({
  state,
  onHandover,
  onReset,
}: {
  state: AppState;
  onHandover: () => void;
  onReset: () => void;
}) {
  const shift = state.shifts.find((s) => s.id === state.currentShiftId)!;
  const next = nextShiftLabel(shift.label);
  return (
    <section className="shift-bar panel">
      <div className="shift-main">
        <div className="shift-dot" />
        <div>
          <p className="eyebrow">当前值班班次</p>
          <h2>
            {shift.label}
            <span className="shift-time">接班于 {fmtTime(shift.startedAt)}</span>
          </h2>
        </div>
      </div>
      <div className="shift-actions">
        <div className="shift-cycle">
          {SHIFT_CYCLE.map((label, i) => (
            <span key={label} className={label === shift.label ? "cycle-on" : ""}>
              {label}
              {i < SHIFT_CYCLE.length - 1 && <em>→</em>}
            </span>
          ))}
        </div>
        <button className="primary-action" onClick={onHandover}>
          交班给{next}
        </button>
        <button className="ghost" onClick={onReset} title="清空本地存档并恢复演示数据">
          重置演示
        </button>
      </div>
    </section>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  hint: string;
  tone: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className={`stat-card tone-${tone} ${active ? "stat-on" : ""}`} onClick={onClick}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      <span className="stat-hint">{hint}</span>
    </button>
  );
}

/* ---------------------------------------------------------------- */

function TankList({
  state,
  selectedId,
  onSelect,
}: {
  state: AppState;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const latestByTank = useMemo(() => {
    const map = new Map<string, Reading>();
    for (const r of state.readings) {
      if (!map.has(r.tankId)) map.set(r.tankId, r);
    }
    return map;
  }, [state.readings]);

  const openCount = (tankId: string) =>
    state.issues.filter((i) => i.tankId === tankId && i.status === "open").length;

  return (
    <div className="tank-list">
      {state.tanks.map((tank) => {
        const latest = latestByTank.get(tank.id);
        const breaches = latest
          ? METRIC_ORDER.filter(
              (k) => latest.values[k] !== undefined && isOverLimit(tank, k, latest.values[k]!)
            )
          : [];
        const count = openCount(tank.id);
        return (
          <button
            key={tank.id}
            className={`tank-card ${selectedId === tank.id ? "tank-on" : ""}`}
            onClick={() => onSelect(tank.id)}
          >
            <div className="tank-head">
              <strong>{tank.name}</strong>
              <span className="tag tag-muted">{tank.tag}</span>
            </div>
            <p className="tank-species">{tank.species}</p>
            <div className="tank-limits">
              {METRIC_ORDER.map((k) => (
                <span key={k} title={`${METRICS[k].label}品种上限`}>
                  {METRICS[k].label}≤{fmtValue(k, tank.limits[k])}
                </span>
              ))}
            </div>
            {latest && (
              <div className="tank-latest">
                {METRIC_ORDER.filter((k) => latest.values[k] !== undefined).map((k) => (
                  <span
                    key={k}
                    className={isOverLimit(tank, k, latest.values[k]!) ? "val-bad" : ""}
                  >
                    {METRICS[k].label} {fmtValue(k, latest.values[k]!)}
                  </span>
                ))}
              </div>
            )}
            <div className="tank-foot">
              {count > 0 ? (
                <span className="tag tag-danger">{count} 条待处理</span>
              ) : (
                <span className="tag tag-ok">无待处理</span>
              )}
              {breaches.length > 0 && (
                <span className="breach-list">超限：{breaches.map((b) => METRICS[b].label).join("、")}</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ReadingForm({
  state,
  tank,
  onSubmit,
}: {
  state: AppState;
  tank: Tank;
  onSubmit: (values: Partial<Record<MetricKey, number>>) => string | null;
}) {
  const empty = () => ({ temp: "", ph: "", nh3: "", no3: "" });
  const [form, setForm] = useState<Record<MetricKey, string>>(empty);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(empty());
    setError(null);
  }, [tank.id]);

  const parsed = (): Partial<Record<MetricKey, number>> | null => {
    const out: Partial<Record<MetricKey, number>> = {};
    for (const k of METRIC_ORDER) {
      const raw = form[k].trim();
      if (!raw) continue;
      const v = Number(raw);
      if (!Number.isFinite(v) || v <= 0) {
        setError(`${METRICS[k].label}请输入大于 0 的数字`);
        return null;
      }
      out[k] = v;
    }
    if (Object.keys(out).length === 0) {
      setError("至少填写一项读数");
      return null;
    }
    return out;
  };

  return (
    <form
      className="reading-form"
      onSubmit={(e) => {
        e.preventDefault();
        const values = parsed();
        if (!values) return;
        const err = onSubmit(values);
        if (err) {
          setError(err);
          return;
        }
        setForm(empty());
        setError(null);
      }}
    >
      <div className="field-grid">
        {METRIC_ORDER.map((k) => {
          const v = form[k] === "" ? NaN : Number(form[k]);
          const bad = Number.isFinite(v) && v > 0 && isOverLimit(tank, k, v);
          return (
            <label key={k} className={bad ? "input-bad" : ""}>
              <span>
                {METRICS[k].label}
                <em>
                  上限 {fmtValue(k, tank.limits[k])}
                  {METRICS[k].unit ? ` ${METRICS[k].unit}` : ""}
                </em>
                {bad && <b className="over-hint">超限</b>}
              </span>
              <input
                inputMode="decimal"
                step={METRICS[k].step}
                placeholder={`填写${METRICS[k].label}`}
                value={form[k]}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
              />
            </label>
          );
        })}
      </div>
      {error && <p className="form-error">{error}</p>}
      <button className="primary-action wide" type="submit">
        提交读数（自动比对品种上限）
      </button>
    </form>
  );
}

function ReadingLog({ state, tank }: { state: AppState; tank: Tank }) {
  const [open, setOpen] = useState(false);
  const shiftOf = (id: string) => state.shifts.find((s) => s.id === id)?.label ?? "已交班";
  const list = state.readings
    .filter((r) => r.tankId === tank.id)
    .sort((a, b) => b.at - a.at)
    .slice(0, open ? 30 : 5);

  return (
    <div className="reading-log">
      <button className="log-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "收起" : "查看"}检查记录（{state.readings.filter((r) => r.tankId === tank.id).length} 次）
        <span className="caret">{open ? "▲" : "▼"}</span>
      </button>
      <div className="log-list">
        {list.length === 0 && <p className="muted">暂无读数，先在上方登记一次。</p>}
        {list.map((r) => (
          <div key={r.id} className="log-row">
            <div className="log-time">
              {fmtTime(r.at)}
              <span className="tag tag-muted">{shiftOf(r.shiftId)}</span>
            </div>
            <div className="log-values">
              {METRIC_ORDER.filter((k) => r.values[k] !== undefined).map((k) => (
                <span
                  key={k}
                  className={isOverLimit(tank, k, r.values[k]!) ? "val-bad" : "val-ok"}
                >
                  {METRICS[k].label} {fmtValue(k, r.values[k]!)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function IssueCard({
  state,
  issue,
  onResolve,
  onQueue,
}: {
  state: AppState;
  issue: WaterIssue;
  onResolve: (id: string, note: string) => void;
  onQueue: (id: string) => void;
}) {
  const tank = state.tanks.find((t) => t.id === issue.tankId)!;
  const owner = state.shifts.find((s) => s.id === issue.ownedByShiftId)?.label ?? "—";
  const linked = issue.linkedWaterTaskId
    ? state.waterTasks.find((t) => t.id === issue.linkedWaterTaskId)
    : undefined;
  const activeLinked =
    linked && (linked.status === "queued" || linked.status === "pending_schedule") ? linked : undefined;
  const [note, setNote] = useState("");

  if (issue.status === "resolved") {
    return (
      <article className="item-card done-card">
        <div className="item-top">
          <strong>{tank.name}</strong>
          <span className="tag tag-muted">已完成</span>
        </div>
        <p className="item-line">
          {METRICS[issue.metric].label} {fmtValue(issue.metric, issue.value)} 超上限{" "}
          {fmtValue(issue.metric, issue.limit)}
        </p>
        <p className="muted small">
          {fmtTime(issue.resolvedAt!)} 关闭 · {issue.resolveNote}
        </p>
      </article>
    );
  }

  return (
    <article className="item-card issue-card">
      <div className="item-top">
        <strong>
          {tank.name} · {METRICS[issue.metric].label}超限
        </strong>
        <span className="tag tag-danger">{owner}负责</span>
      </div>
      <p className="item-line">
        实测 <b className="val-bad">{fmtValue(issue.metric, issue.value)}</b>
        <span className="muted">（品种上限 {fmtValue(issue.metric, issue.limit)}）</span>
      </p>
      <p className="muted small">
        开单于 {fmtTime(issue.openedAt)}
        {issue.checks.length > 0 && (
          <>
            {" "}
            · 复测检查 {issue.checks.length} 次：
            {issue.checks
              .slice(-3)
              .map((c) => fmtValue(issue.metric, c.value))
              .join("、")}
          </>
        )}
      </p>
      {activeLinked && (
        <p className="linked-line">
          {activeLinked.status === "queued" ? (
            <>
              换水已排 <b>{SLOTS.find((s) => s.id === activeLinked.slotId)?.label}</b>
              <span className={badgeClass(activeLinked.urgency)}>
                {urgencyLabel(activeLinked.urgency)}
              </span>
            </>
          ) : (
            <>
              换水<span className="tag tag-danger">待排</span>
              <span className="blocked-note">{activeLinked.blockedReason}</span>
            </>
          )}
        </p>
      )}
      <div className="item-actions">
        {!activeLinked && (
          <button onClick={() => onQueue(issue.id)}>排入换水队列</button>
        )}
        <input
          placeholder="处理备注（可选），如：已加盐、停喂观察"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button onClick={() => onResolve(issue.id, note)}>复测恢复，关闭</button>
      </div>
    </article>
  );
}

function WaterTaskCard({
  state,
  task,
  onComplete,
  onCancel,
}: {
  state: AppState;
  task: WaterChangeTask;
  onComplete: (id: string, note: string) => void;
  onCancel: (id: string) => void;
}) {
  const tank = state.tanks.find((t) => t.id === task.tankId)!;
  const owner = state.shifts.find((s) => s.id === task.ownedByShiftId)?.label ?? "—";
  const tag = statusTag(task.status);
  const [note, setNote] = useState("");

  return (
    <article className={`item-card task-card task-${task.status}`}>
      <div className="item-top">
        <strong>
          {tank.name} · 换水 {task.percent}%
        </strong>
        <span className={badgeClass(task.urgency)}>{urgencyLabel(task.urgency)}</span>
        <span className={tag.cls}>{tag.text}</span>
      </div>
      <p className="item-line">{task.reason}</p>
      <p className="muted small">
        登记于 {fmtTime(task.createdAt)} · {owner}负责
        {task.source === "manual" && " · 手动登记"}
      </p>
      {task.status === "queued" && (
        <p className="slot-line">时段：{SLOTS.find((s) => s.id === task.slotId)?.label}</p>
      )}
      {task.status === "pending_schedule" && (
        <p className="blocked-box">
          <b>待排原因：</b>
          {task.blockedReason}
        </p>
      )}
      {task.status === "done" && (
        <p className="muted small">
          {task.slotId && <>时段 {SLOTS.find((s) => s.id === task.slotId)?.label} · </>}
          {fmtTime(task.completedAt!)} 完成{task.completeNote ? ` · ${task.completeNote}` : ""}
        </p>
      )}
      {task.status === "cancelled" && <p className="muted small">{task.blockedReason}</p>}
      {(task.status === "queued" || task.status === "pending_schedule") && (
        <div className="item-actions">
          <input
            placeholder="完成备注（可选），如：换水后温度 26.1℃"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="primary-action" onClick={() => onComplete(task.id, note)}>
            换水完成
          </button>
          <button className="ghost" onClick={() => onCancel(task.id)}>
            撤销
          </button>
        </div>
      )}
    </article>
  );
}

/* ---------------------------------------------------------------- */

function SlotBoard({ state }: { state: AppState }) {
  const bySlot = (slotId: string) =>
    state.waterTasks.filter((t) => t.slotId === slotId && t.status !== "cancelled");

  return (
    <div className="slot-board">
      {SLOTS.map((slot) => {
        const tasks = bySlot(slot.id);
        const queued = tasks.find((t) => t.status === "queued");
        const done = tasks.find((t) => t.status === "done");
        const tank = queued
          ? state.tanks.find((t) => t.id === queued.tankId)
          : done
            ? state.tanks.find((t) => t.id === done.tankId)
            : undefined;
        return (
          <div
            key={slot.id}
            className={`slot ${queued ? "slot-busy" : done ? "slot-done" : "slot-free"}`}
          >
            <span className="slot-time">{slot.label}</span>
            {queued && tank ? (
              <span className="slot-tank">
                {tank.name} · {queued.percent}%
                <i className={badgeClass(queued.urgency)}>{urgencyLabel(queued.urgency)}</i>
              </span>
            ) : done && tank ? (
              <span className="slot-tank muted">
                {tank.name}（已完成 · 历史）
              </span>
            ) : (
              <span className="slot-tank muted">空闲</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ManualWaterForm({
  state,
  onAdd,
}: {
  state: AppState;
  onAdd: (tankId: string, percent: number) => string | null;
}) {
  const [tankId, setTankId] = useState(state.tanks[0].id);
  const [percent, setPercent] = useState("30");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="manual-form"
      onSubmit={(e) => {
        e.preventDefault();
        const p = Number(percent);
        if (!Number.isFinite(p) || p <= 0 || p > 100) {
          setError("换水量需为 1-100 之间的百分比");
          return;
        }
        setError(onAdd(tankId, p));
      }}
    >
      <label>
        <span>鱼缸</span>
        <select value={tankId} onChange={(e) => setTankId(e.target.value)}>
          {state.tanks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>换水量 %</span>
        <input
          inputMode="numeric"
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
        />
      </label>
      <button className="primary-action" type="submit">
        登记换水并排期
      </button>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}

function HandoverLog({ state }: { state: AppState }) {
  const labelOf = (id: string) => state.shifts.find((s) => s.id === id)?.label ?? "—";
  return (
    <div className="handover-log">
      {state.handovers.map((h) => (
        <div key={h.id} className="handover-row">
          <span className="log-time">{fmtTime(h.at)}</span>
          <span>
            {labelOf(h.fromShiftId)} → <b>{labelOf(h.toShiftId)}</b>
          </span>
          <span className="muted small">
            转交 {h.issueCount} 条待处理项、{h.taskCount} 个换水任务
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- */

function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [tab, setTab] = useState<FilterTab>("pending");
  const [selectedTankId, setSelectedTankId] = useState<string>(state.tanks[0].id);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const pushToast = (text: string, kind: Toast["kind"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, text, kind }]);
    window.setTimeout(() => {
      setToasts((ts) => ts.filter((t) => t.id !== id));
    }, 4200);
  };

  const tank = state.tanks.find((t) => t.id === selectedTankId) ?? state.tanks[0];

  const openIssues = state.issues.filter((i) => i.status === "open");
  const activeTasks = state.waterTasks.filter(
    (t) => t.status === "queued" || t.status === "pending_schedule"
  );
  const blockedTasks = activeTasks.filter((t) => t.status === "pending_schedule");
  const resolvedIssues = state.issues.filter((i) => i.status === "resolved");
  const finishedTasks = state.waterTasks.filter(
    (t) => t.status === "done" || t.status === "cancelled"
  );

  const sortedIssues = (list: WaterIssue[]) =>
    [...list].sort((a, b) => b.openedAt - a.openedAt);
  const sortedTasks = (list: WaterChangeTask[]) =>
    [...list].sort((a, b) => {
      const rank = { queued: 0, pending_schedule: 1, done: 2, cancelled: 3 } as const;
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      if (a.status === "queued" && b.status === "queued") {
        return SLOTS.findIndex((s) => s.id === a.slotId) - SLOTS.findIndex((s) => s.id === b.slotId);
      }
      return b.createdAt - a.createdAt;
    });

  const handleReading = (values: Partial<Record<MetricKey, number>>): string | null => {
    const { state: next, message } = ingestReading(state, tank.id, values, Date.now());
    setState(next);
    pushToast(
      message,
      message.includes("正常") && !message.includes("超限") ? "ok" : "warn"
    );
    return null;
  };

  const handleResolve = (id: string, note: string) => {
    const r = resolveIssue(state, id, Date.now(), note);
    setState(r.state);
    pushToast(r.message);
  };

  const handleQueueIssue = (id: string) => {
    const r = queueWaterForIssue(state, id, Date.now());
    setState(r.state);
    pushToast(r.message, r.message.includes("冲突") ? "warn" : "ok");
  };

  const handleComplete = (id: string, note: string) => {
    const r = completeWaterTask(state, id, Date.now(), note);
    setState(r.state);
    pushToast(r.message);
  };

  const handleCancel = (id: string) => {
    const r = cancelWaterTask(state, id);
    setState(r.state);
    pushToast(r.message);
  };

  const handleManual = (tankId: string, percent: number): string | null => {
    const r = queueManualWater(state, tankId, percent, Date.now());
    setState(r.state);
    pushToast(r.message, r.message.includes("冲突") ? "warn" : "ok");
    return null;
  };

  const handleHandover = () => {
    const open = state.issues.filter((i) => i.status === "open").length;
    const tasks = activeTasks.length;
    const shift = state.shifts.find((s) => s.id === state.currentShiftId)!;
    const to = nextShiftLabel(shift.label);
    if (!window.confirm(`交班给${to}？\n未完成的 ${open} 条待处理项与 ${tasks} 个换水任务将转到${to}名下。`)) {
      return;
    }
    const r = handover(state, Date.now());
    setState(r.state);
    pushToast(r.message);
  };

  const handleReset = () => {
    if (!window.confirm("恢复演示数据？当前本地登记的记录将被清空。")) return;
    setState(resetState());
    setSelectedTankId("tank-1");
    setTab("pending");
    pushToast("已恢复演示数据");
  };

  const queuedTasks = sortedTasks(activeTasks.filter((t) => t.status === "queued"));
  const pendingTasks = sortedTasks(blockedTasks);

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-05 · 晚班交接值班台</p>
          <h1>多缸水质值班台</h1>
          <p className="subtitle">
            登记水温、pH、氨氮、硝酸盐读数，超过品种上限自动生成待处理项；同缸同项未处理完只补检查记录。换水按紧急度排入当晚时段，一缸一时段，冲突停在待排并说明；交班后责任转到下一班，关闭页面再打开仍接得上。
          </p>
        </div>
        <div className="stack-card">
          <span>当晚时段占用</span>
          <strong>
            {queuedTasks.length}/{SLOTS.length} 个时段已排
          </strong>
          <span className="muted small">
            {pendingTasks.length} 项换水待排 · {openIssues.length} 条指标待处理
          </span>
        </div>
      </section>

      <ShiftBar state={state} onHandover={handleHandover} onReset={handleReset} />

      <section className="stats-grid">
        <StatCard
          label="待处理项"
          value={openIssues.length}
          hint="超限指标，未关闭"
          tone="danger"
          active={tab === "pending"}
          onClick={() => setTab("pending")}
        />
        <StatCard
          label="待排换水"
          value={blockedTasks.length}
          hint="时段冲突，等待顺延"
          tone="warn"
          active={tab === "pending"}
          onClick={() => setTab("pending")}
        />
        <StatCard
          label="已排换水"
          value={queuedTasks.length}
          hint={`当晚共 ${SLOTS.length} 个时段`}
          tone="ok"
          active={tab === "water"}
          onClick={() => setTab("water")}
        />
        <StatCard
          label="已完成"
          value={resolvedIssues.length + finishedTasks.length}
          hint="复测恢复 / 换水完成"
          tone="muted"
          active={tab === "done"}
          onClick={() => setTab("done")}
        />
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <div className="section-heading">
            <div>
              <p>鱼缸花名册</p>
              <h2>选择鱼缸登记</h2>
            </div>
          </div>
          <TankList state={state} selectedId={tank.id} onSelect={setSelectedTankId} />
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>{tank.tag} · {tank.species}</p>
              <h2>{tank.name} · 水质读数登记</h2>
            </div>
          </div>
          <ReadingForm state={state} tank={tank} onSubmit={handleReading} />
          <ReadingLog state={state} tank={tank} />
        </section>
      </section>

      <section className="panel duty-panel">
        <div className="section-heading">
          <div>
            <p>当班任务</p>
            <h2>值班事项</h2>
          </div>
          <div className="tab-bar">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? "tab-on" : ""}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {(tab === "pending" || tab === "all") && (
          <div className="duty-group">
            <h3>
              待处理{tab === "all" && <span className="muted small">（超限指标 + 待排换水）</span>}
            </h3>
            {pendingTasks.length > 0 && (
              <>
                <p className="group-note warn-note">
                  以下换水项因「一缸一时段」冲突停在待排，完成本缸换水后会自动顺延补位：
                </p>
                <div className="item-grid">
                  {pendingTasks.map((t) => (
                    <WaterTaskCard
                      key={t.id}
                      state={state}
                      task={t}
                      onComplete={handleComplete}
                      onCancel={handleCancel}
                    />
                  ))}
                </div>
              </>
            )}
            <div className="item-grid">
              {sortedIssues(openIssues).map((i) => (
                <IssueCard
                  key={i.id}
                  state={state}
                  issue={i}
                  onResolve={handleResolve}
                  onQueue={handleQueueIssue}
                />
              ))}
              {openIssues.length === 0 && pendingTasks.length === 0 && (
                <p className="muted empty-line">当前没有待处理项，水质正常。</p>
              )}
            </div>
          </div>
        )}

        {(tab === "water" || tab === "all") && (
          <div className="duty-group">
            <h3>换水安排</h3>
            <SlotBoard state={state} />
            {tab === "water" && (
              <>
                <h4>手动登记换水</h4>
                <ManualWaterForm state={state} onAdd={handleManual} />
              </>
            )}
            <div className="item-grid">
              {sortedTasks(activeTasks).map((t) => (
                <WaterTaskCard
                  key={t.id}
                  state={state}
                  task={t}
                  onComplete={handleComplete}
                  onCancel={handleCancel}
                />
              ))}
              {activeTasks.length === 0 && <p className="muted empty-line">当晚暂无换水任务。</p>}
            </div>
          </div>
        )}

        {(tab === "done" || tab === "all") && (
          <div className="duty-group">
            <h3>已完成{tab === "all" && <span className="muted small">（含已撤销换水）</span>}</h3>
            <div className="item-grid">
              {sortedTasks(finishedTasks).map((t) => (
                <WaterTaskCard
                  key={t.id}
                  state={state}
                  task={t}
                  onComplete={handleComplete}
                  onCancel={handleCancel}
                />
              ))}
              {sortedIssues(resolvedIssues).map((i) => (
                <IssueCard
                  key={i.id}
                  state={state}
                  issue={i}
                  onResolve={handleResolve}
                  onQueue={handleQueueIssue}
                />
              ))}
              {finishedTasks.length === 0 && resolvedIssues.length === 0 && (
                <p className="muted empty-line">还没有已完成事项。</p>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>交班记录</p>
            <h2>责任交接链</h2>
          </div>
        </div>
        <HandoverLog state={state} />
      </section>

      <footer className="page-foot">
        数据保存在本机浏览器（localStorage），关闭再打开自动接续；可点右上角「重置演示」还原。
      </footer>

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </main>
  );
}

export default App;
