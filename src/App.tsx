import { useMemo, useState } from "react";
import "./styles.css";
import type { DeskState, ReadingValues, WaterTask } from "./types";
import {
  assignSlot,
  autoSchedule,
  availableSlots,
  clearSlot,
  closeIssue,
  completeTask,
  currentShift,
  enqueueRoutineTask,
  enqueueTaskForIssue,
  formatTime,
  openIssues,
  removeQueuedTask,
  shiftById,
  submitReading,
  tankById,
  updateClerk,
  handoverShift,
  addTank,
} from "./model";
import { useDeskStore } from "./store";
import { ReadingForm } from "./components/ReadingForm";
import { IssueCard, IssueList } from "./components/IssueList";
import { WaterBoard } from "./components/WaterBoard";
import { ReadingsLog, TankOverview } from "./components/Panels";
import { ShiftBar } from "./components/ShiftBar";
import { Empty, SectionTitle } from "./components/ui";

type TabKey = "pending" | "water" | "done" | "all";

const TABS: { key: TabKey; label: string }[] = [
  { key: "pending", label: "待处理" },
  { key: "water", label: "换水" },
  { key: "done", label: "已完成" },
  { key: "all", label: "全部动态" },
];

function DoneTaskCard({ state, task }: { state: DeskState; task: WaterTask }) {
  const tank = tankById(state, task.tankId);
  const shift = task.completedShiftId ? shiftById(state, task.completedShiftId) : undefined;
  return (
    <article className="issue-card is-closed">
      <header className="issue-head">
        <div className="issue-title">
          <span className="tank-name">{tank?.name ?? "已删鱼缸"}</span>
          <span className="badge tone-muted">已换水{task.slot ? ` · ${task.slot}` : ""}</span>
        </div>
        <div className="issue-meta">
          <span>
            {task.completedAt ? formatTime(task.completedAt) : ""}
            {shift ? ` · ${shift.label}·${shift.clerk}` : ""}
          </span>
        </div>
      </header>
      <p className="task-reason">{task.reason}</p>
    </article>
  );
}

function HandoverLog({ state }: { state: DeskState }) {
  if (state.handovers.length === 0) return <Empty text="还没有交班记录" />;
  return (
    <ul className="handover-log">
      {[...state.handovers].reverse().map((h) => {
        const from = shiftById(state, h.fromShiftId);
        const to = shiftById(state, h.toShiftId);
        return (
          <li key={h.id}>
            <strong>{formatTime(h.at)}</strong>
            <p>
              {from?.label} {h.fromClerk} → {to?.label} {h.toClerk}
            </p>
            <span>
              移交：待处理 {h.openIssueCount} 项 · 待排换水 {h.pendingTaskCount} 项 · 已排{" "}
              {h.scheduledTaskCount} 项
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function App() {
  const { state, setState, toasts, pushToast, resetDemo } = useDeskStore();
  const [tab, setTab] = useState<TabKey>("pending");
  const [tankFilter, setTankFilter] = useState<string | null>(null);

  const shift = currentShift(state);

  const issuesOpen = useMemo(() => openIssues(state), [state]);
  const closedIssues = useMemo(
    () =>
      [...state.issues]
        .filter((i) => i.status === "closed")
        .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)),
    [state]
  );
  const queuedTasks = state.tasks.filter((t) => t.status === "queued");
  const scheduledTasks = state.tasks.filter((t) => t.status === "scheduled");
  const doneTasks = state.tasks.filter((t) => t.status === "done");

  const counts: Record<TabKey, number> = {
    pending: issuesOpen.length,
    water: queuedTasks.length + scheduledTasks.length,
    done: closedIssues.length + doneTasks.length,
    all: state.readings.length,
  };

  const filterByTank = <T extends { tankId: string }>(arr: T[]): T[] =>
    tankFilter ? arr.filter((x) => x.tankId === tankFilter) : arr;

  const tryAction = (label: string | (() => string), action: () => void) => {
    try {
      action();
      pushToast(typeof label === "function" ? label() : label, "ok");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "操作失败", "err");
    }
  };

  const handleSubmitReading = (tankId: string, values: ReadingValues, note: string) => {
    try {
      const result = submitReading(state, { tankId, values, note });
      setState(result.state);
      const tank = tankById(result.state, tankId);
      const parts: string[] = [];
      if (result.newIssues.length > 0)
        parts.push(`【${tank?.name}】新增 ${result.newIssues.length} 项待处理`);
      if (result.appendedIssueIds.length > 0)
        parts.push("同缸同项未处理完：已补检查记录，不重复建项");
      if (result.newTasks.length > 0) parts.push("换水任务已进入待排队列");
      if (result.rechecks.length > 0) parts.push("复测达标，可关闭待处理项");
      if (parts.length === 0) parts.push("读数已登记，全部在安全范围");
      pushToast(parts.join("；"), result.newIssues.length > 0 ? "err" : "ok");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "提交失败", "err");
    }
  };

  const handleAutoSchedule = () => {
    const result = autoSchedule(state);
    setState(result.state);
    const blocked = result.state.tasks.filter((t) => t.status === "queued").length;
    if (result.scheduledCount > 0) {
      pushToast(
        `已按紧急程度排入 ${result.scheduledCount} 个时段` +
          (blocked > 0 ? `；${blocked} 项冲突停在待排` : ""),
        blocked > 0 ? "info" : "ok"
      );
    } else if (blocked > 0) {
      pushToast("存在冲突项：同缸占一个时段或时段已满，停在待排（卡片内有说明）", "info");
    } else {
      pushToast("待排队列为空", "info");
    }
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">多缸水质值班台 · 晚班交接</p>
          <h1>水族店水质值班台</h1>
          <p className="subtitle">
            登记各缸水温、pH、氨氮和硝酸盐；超过品种上限自动生成待处理项，换水按紧急程度排入当晚时段，
            交班后未完成项责任转到下一班，关闭再打开仍接得上。
          </p>
        </div>
        <div className="stack-card">
          <span>数据保存</span>
          <strong>本地浏览器持久化</strong>
          <em>关闭页面再打开，队列、复测与交班记录仍在</em>
        </div>
      </header>

      <ShiftBar
        state={state}
        onUpdateClerk={(clerk) =>
          tryAction("责任人已更新", () => setState(updateClerk(state, clerk)))
        }
        onHandover={(nextClerk) => {
          try {
            const result = handoverShift(state, nextClerk);
            setState(result.state);
            const h = result.state.handovers[result.state.handovers.length - 1];
            pushToast(
              `交班完成：${h.openIssueCount} 项待处理与未完成换水已转到下一班`,
              "ok"
            );
          } catch (err) {
            pushToast(err instanceof Error ? err.message : "交班失败", "err");
          }
        }}
        onAddTank={(name, species) =>
          tryAction("新鱼缸已登记，可录入读数", () =>
            setState(addTank(state, { name, species }))
          )
        }
        onReset={resetDemo}
      />

      <section className="tank-overview panel">
        <SectionTitle
          title="鱼缸总览"
          desc={
            tankFilter
              ? "正在只看一个鱼缸，再次点击该缸卡片可取消筛选"
              : "点击鱼缸卡片，只看这一缸的任务与记录；数字为未关闭待处理项"
          }
          extra={
            tankFilter ? (
              <button className="small-btn outline" onClick={() => setTankFilter(null)}>
                清除筛选（看全部缸）
              </button>
            ) : undefined
          }
        />
        <TankOverview
          state={state}
          selectedTank={tankFilter}
          onSelectTank={(id) => setTankFilter((cur) => (cur === id ? null : id))}
        />
      </section>

      <ReadingForm
        key={tankFilter ?? "all"}
        state={state}
        tankId={tankFilter ?? state.tanks[0]?.id ?? ""}
        onSelectTank={(id) => setTankFilter(id)}
        onSubmit={handleSubmitReading}
      />

      <nav className="tab-bar" aria-label="视图筛选">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className="tab-count">{counts[t.key]}</span>
          </button>
        ))}
      </nav>

      {tab === "pending" && (
        <section className="panel">
          <SectionTitle
            title="待处理项"
            desc="按紧急程度排序；同缸同项未处理完时，再测超限只补检查记录"
          />
          <IssueList
            state={state}
            issues={filterByTank(issuesOpen)}
            allowActions
            onClose={(id) =>
              tryAction("已关闭：复测达标，本项处理完成", () =>
                setState(closeIssue(state, id))
              )
            }
            onEnqueue={(id) =>
              tryAction("已加入换水待排队列", () =>
                setState(enqueueTaskForIssue(state, id))
              )
            }
          />
        </section>
      )}

      {tab === "water" && (
        <WaterBoard
          state={state}
          allowActions
          onAuto={handleAutoSchedule}
          onAssign={(id, slot) =>
            tryAction(`已排入 ${slot}`, () => setState(assignSlot(state, id, slot)))
          }
          onClear={(id) => tryAction("已撤回待排", () => setState(clearSlot(state, id)))}
          onComplete={(id) =>
            tryAction("换水完成，已记录", () => setState(completeTask(state, id)))
          }
          onRemove={(id) =>
            tryAction("已移出换水队列", () => setState(removeQueuedTask(state, id)))
          }
          onRoutine={(tankId, reason) =>
            tryAction("计划换水已加入待排", () =>
              setState(enqueueRoutineTask(state, tankId, reason))
            )
          }
        />
      )}

      {tab === "done" && (
        <div className="done-columns">
          <section className="panel">
            <SectionTitle title="已完成的待处理项" desc="达标复测后人工关闭" />
            {filterByTank(closedIssues).length === 0 ? (
              <Empty text="还没有已完成项" />
            ) : (
              <div className="card-list">
                {filterByTank(closedIssues).map((issue) => (
                  <IssueCard
                    key={issue.id}
                    state={state}
                    issue={issue}
                    allowActions={false}
                    showClosed
                    onClose={() => undefined}
                    onEnqueue={() => undefined}
                  />
                ))}
              </div>
            )}
          </section>
          <section className="panel">
            <SectionTitle title="已完成的换水" />
            {filterByTank(doneTasks).length === 0 ? (
              <Empty text="今晚还没有完成换水" />
            ) : (
              <div className="card-list">
                {filterByTank(doneTasks).map((task) => (
                  <DoneTaskCard key={task.id} state={state} task={task} />
                ))}
              </div>
            )}
          </section>
          <section className="panel">
            <SectionTitle title="交班记录" desc="未完成责任随交班移交" />
            <HandoverLog state={state} />
          </section>
        </div>
      )}

      {tab === "all" && (
        <div className="all-grid">
          <section className="panel">
            <SectionTitle title="待处理与换水队列" />
            <h4 className="sub-h">未关闭待处理项（{filterByTank(issuesOpen).length}）</h4>
            <IssueList
              state={state}
              issues={filterByTank(issuesOpen)}
              allowActions={false}
              onClose={() => undefined}
              onEnqueue={() => undefined}
            />
            <h4 className="sub-h">
              换水：待排 {filterByTank(queuedTasks).length} · 已排{" "}
              {filterByTank(scheduledTasks).length}
            </h4>
            {filterByTank([...queuedTasks, ...scheduledTasks]).length === 0 ? (
              <Empty text="今晚暂无换水安排" />
            ) : (
              <ul className="plain-task-list">
                {filterByTank([...queuedTasks, ...scheduledTasks]).map((t) => (
                  <li key={t.id}>
                    <div>
                      <span className="tank-name">{tankById(state, t.tankId)?.name}</span>
                      <em>{t.status === "scheduled" ? `已排 ${t.slot}` : "待排"}</em>
                    </div>
                    <p>{t.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="panel">
            <SectionTitle title="检测台账" desc="超限读数标红；复测记录挂在对应待处理项上" />
            <ReadingsLog state={state} tankId={tankFilter} onSelectTank={(id) => setTankFilter(id)} />
          </section>
        </div>
      )}

      <footer className="page-foot">
        空闲时段：{availableSlots(state).join(" / ") || "今晚已满"} · 当前班次{" "}
        {shift.label}·{shift.clerk}
      </footer>

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast tone-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </main>
  );
}

export default App;
