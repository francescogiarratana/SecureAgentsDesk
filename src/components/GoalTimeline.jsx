import { useState } from 'react';

const STATUS_CONFIG = {
  PENDING: { icon: '⏳', label: 'In attesa', className: 'step-pending' },
  IN_PROGRESS: { icon: '🔄', label: 'In corso', className: 'step-in-progress' },
  COMPLETED: { icon: '✅', label: 'Completato', className: 'step-completed' },
  FAILED: { icon: '❌', label: 'Fallito', className: 'step-failed' },
  SKIPPED: { icon: '⏭️', label: 'Saltato', className: 'step-skipped' },
  AWAITING_APPROVAL: { icon: '⏸️', label: 'In approvazione', className: 'step-awaiting' },
};

const RISK_CONFIG = {
  read_only: { label: 'Lettura', className: 'risk-read' },
  write: { label: 'Scrittura', className: 'risk-write' },
  client_action: { label: 'Locale', className: 'risk-client' },
  unknown: { label: 'Sconosciuto', className: 'risk-unknown' },
};

const GOAL_STATUS_CONFIG = {
  PLANNING: { label: 'Pianificazione', className: 'goal-planning' },
  CONFIRMED: { label: 'Confermato', className: 'goal-confirmed' },
  IN_PROGRESS: { label: 'In esecuzione', className: 'goal-in-progress' },
  COMPLETED: { label: 'Completato', className: 'goal-completed' },
  FAILED: { label: 'Fallito', className: 'goal-failed' },
  CANCELLED: { label: 'Annullato', className: 'goal-cancelled' },
};

function formatDuration(ms) {
  if (!ms) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function GoalTimeline({ goal, onCancel, onStepClick }) {
  if (!goal) return null;

  const completedCount = goal.steps.filter(s => s.status === 'COMPLETED').length;
  const totalSteps = goal.steps.length;
  const goalConfig = GOAL_STATUS_CONFIG[goal.status] || GOAL_STATUS_CONFIG.PLANNING;
  const canCancel = ['CONFIRMED', 'IN_PROGRESS'].includes(goal.status);

  return (
    <div className="goal-timeline">
      <div className="goal-timeline-header">
        <div className="goal-timeline-title">
          <span className="goal-icon">🎯</span>
          <span className="goal-description">{goal.description}</span>
        </div>
        <div className="goal-timeline-meta">
          <span className={`goal-status-badge ${goalConfig.className}`}>{goalConfig.label}</span>
          {totalSteps > 0 && (
            <span className="goal-progress">{completedCount}/{totalSteps} completati</span>
          )}
        </div>
        {canCancel && (
          <button className="goal-cancel-btn" onClick={() => onCancel(goal.id)} title="Annulla obiettivo">
            ✕ Annulla
          </button>
        )}
      </div>

      {totalSteps > 0 && (
        <div className="goal-steps-timeline">
          {goal.steps.map((step, idx) => {
            const statusConf = STATUS_CONFIG[step.status] || STATUS_CONFIG.PENDING;
            const riskConf = RISK_CONFIG[step.risk_level] || RISK_CONFIG.unknown;
            const duration = formatDuration(step.duration_ms);

            return (
              <div
                key={step.id}
                className={`goal-step ${statusConf.className}`}
                onClick={() => onStepClick(step)}
                role="button"
                tabIndex={0}
              >
                <div className="step-connector">
                  <div className={`step-dot ${statusConf.className}`}>
                    <span className="step-dot-icon">{statusConf.icon}</span>
                  </div>
                  {idx < goal.steps.length - 1 && <div className="step-line" />}
                </div>
                <div className="step-content">
                  <div className="step-header">
                    <span className="step-number">Passo {step.step_number}</span>
                    <span className="step-tool-name">{step.tool_name || 'Passo logico'}</span>
                    <span className={`step-risk-badge ${riskConf.className}`}>{riskConf.label}</span>
                    {step.approval_track && (
                      <span className="step-approval-badge">
                        {step.approval_track === 'self' ? '👤 Self' : '👥 Management'}
                      </span>
                    )}
                  </div>
                  <p className="step-rationale">{step.rationale}</p>
                  <div className="step-footer">
                    <span className={`step-status-label ${statusConf.className}`}>{statusConf.label}</span>
                    {duration && <span className="step-duration">⏱ {duration}</span>}
                    {step.error_message && (
                      <span className="step-error" title={step.error_message}>
                        ⚠️ {step.error_message.slice(0, 60)}...
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
