import type { DeskState, Issue } from "../types";
import {
  METRIC_LABEL,
  formatTime,
  formatValue,
  issueCheckReadings,
  issueUrgency,
  readingById,
  shiftLabel,
  tankById,
} from "../model";
import { Empty, MetricTag, UrgencyBadge } from "./ui";

interface IssueListProps {
  state: DeskState;
  issues: Issue[];
  onClose: (issueId: string) => void;
  onEnqueue: (issueId: string) => void;
  allowActions: boolean;
}

export function IssueList({
  state,
  issues,
  onClose,
  onEnqueue,
  allowActions,
}: IssueListProps) {
  if (issues.length === 0) return <Empty text="暂无待处理项" />;
  return (
    <div className="card-list">
      {issues.map((issue) => (
        <IssueCard
          key={issue.id}
          state={state}
          issue={issue}
          onClose={onClose}
          onEnqueue={onEnqueue}
          allowActions={allowActions}
        />
      ))}
    </div>
  );
}

const metricUnit: Record<string, string> = { temp: "℃", nh3: "ppm", no3: "ppm", ph: "" };

export function IssueCard({
  state,
  issue,
  onClose,
  onEnqueue,
  allowActions,
  showClosed = false,
}: {
  state: DeskState;
  issue: Issue;
  onClose: (issueId: string) => void;
  onEnqueue: (issueId: string) => void;
  allowActions: boolean;
  showClosed?: boolean;
}) {
  const tank = tankById(state, issue.tankId);
  const first = readingById(state, issue.firstReadingId);
  const checks = issueCheckReadings(state, issue).slice(1);
  const recheck = issue.recheckReadingId ? readingById(state, issue.recheckReadingId) : undefined;
  const urgency = issueUrgency(state, issue);
  const activeShiftId = state.shifts.find((s) => s.active)?.id;
  const handedOver = issue.status === "open" && issue.ownerShiftId !== activeShiftId;
  const firstValue = first?.[issue.metric];
  const activeTask = state.tasks.find(
    (t) => t.issueId === issue.id && t.status !== "done"
  );
  const tankBusy = state.tasks.some(
    (t) => t.tankId === issue.tankId && t.status !== "done" && t.issueId !== issue.id
  );
  const needsWater = issue.metric === "nh3" || issue.metric === "no3";

  return (
    <article className={`issue-card ${issue.status === "closed" ? "is-closed" : ""}`}>
      <header className="issue-head">
        <div className="issue-title">
          <span className="tank-name">{tank?.name ?? "已删鱼缸"}</span>
          <MetricTag metric={issue.metric} />
          {issue.status === "open" ? (
            <UrgencyBadge urgency={urgency} />
          ) : (
            <span className="badge tone-muted">已完成</span>
          )}
        </div>
        <div className="issue-meta">
          <span>
            首测 {first ? formatTime(first.at) : "—"} · {shiftLabel(state, issue.openedShiftId)}
          </span>
          {handedOver && <span className="owner-tag">交班后现归 {shiftLabel(state, issue.ownerShiftId)}</span>}
        </div>
      </header>

      <div className="issue-body">
        <div className="issue-values">
          {firstValue !== undefined && (
            <div className="value-pill over-limit">
              <span>首测值</span>
              <strong>
                {formatValue(issue.metric, firstValue as number)}
                {metricUnit[issue.metric] ? ` ${metricUnit[issue.metric]}` : ""}
              </strong>
              <i>上限 {formatValue(issue.metric, issue.limit)}</i>
            </div>
          )}
          {checks.length > 0 && (
            <div className="value-pill checks">
              <span>补测检查 ×{checks.length}</span>
              {checks.map((r) => (
                <em key={r.id}>
                  {formatTime(r.at)}{" "}
                  {formatValue(issue.metric, r[issue.metric] as number)}
                  {metricUnit[issue.metric] ? ` ${metricUnit[issue.metric]}` : ""}
                </em>
              ))}
            </div>
          )}
          {recheck && (
            <div className="value-pill recheck-ok">
              <span>复测达标</span>
              <strong>
                {formatValue(issue.metric, recheck[issue.metric] as number)}
                {metricUnit[issue.metric] ? ` ${metricUnit[issue.metric]}` : ""}
              </strong>
              <i>{formatTime(recheck.at)} · {recheck.clerk}</i>
            </div>
          )}
        </div>

        {issue.status === "open" && (
          <div className="issue-note-line">
            {!recheck && (
              <span className="hint-warn">尚未复测达标：再登记一次不超过上限的读数即可复测</span>
            )}
            {recheck && <span className="hint-ok">复测已达标，可关闭本项</span>}
            {needsWater && activeTask && (
              <span className="hint-info">
                换水任务：{activeTask.status === "scheduled" ? `已排 ${activeTask.slot}` : "待排中"}
              </span>
            )}
            {needsWater && !activeTask && tankBusy && (
              <span className="hint-warn">该缸今晚已有换水安排，先完成现有换水再补排</span>
            )}
          </div>
        )}
        {showClosed && issue.status === "closed" && (
          <div className="issue-note-line">
            <span className="hint-ok">
              完成于 {issue.closedAt ? formatTime(issue.closedAt) : "—"} ·{" "}
              {issue.closedShiftId ? shiftLabel(state, issue.closedShiftId) : ""}
            </span>
          </div>
        )}
      </div>

      {allowActions && issue.status === "open" && (
        <footer className="issue-actions">
          <button
            className="small-btn"
            disabled={!recheck}
            title={recheck ? "" : "需要一次达标复测"}
            onClick={() => onClose(issue.id)}
          >
            复测达标，关闭本项
          </button>
          {needsWater && !activeTask && (
            <button className="small-btn outline" onClick={() => onEnqueue(issue.id)}>
              加排换水
            </button>
          )}
        </footer>
      )}
    </article>
  );
}
