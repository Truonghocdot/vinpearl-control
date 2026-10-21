import { useEffect, useState } from 'react';
import type { WorkflowDefinition, WorkflowLog, WorkflowRun, WorkflowSummary } from './types';
import ScriptRunnerPanel from './ScriptRunnerPanel';

const actionLabels: Record<string, string> = {
  launchApp: 'Mở ứng dụng',
  waitForText: 'Chờ text',
  tapText: 'Chạm text',
  inputText: 'Nhập liệu',
  selectDate: 'Chọn ngày',
  selectGuests: 'Chọn phòng/khách',
  assertText: 'Kiểm tra text',
  sshCommand: 'SSH command',
  stop: 'Dừng workflow',
};

function statusLabel(status: WorkflowRun['status']) {
  if (status === 'succeeded') return 'Hoàn tất';
  if (status === 'stopped') return 'Đã dừng an toàn';
  return 'Thất bại';
}

export default function WorkflowPanel() {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null);
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [isRunning, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    window.desktopApi.listWorkflows().then((items) => {
      setWorkflows(items);
      setSelectedId(items[0]?.id ?? '');
    }).catch(() => setError('Không thể đọc workflow từ SQLite.'));
  }, []);

  const selected = workflows.find((workflow) => workflow.id === selectedId);

  useEffect(() => {
    if (!selectedId) return;
    window.desktopApi.getWorkflow(selectedId).then(setDefinition).catch(() => setError('Không thể đọc definition workflow.'));
  }, [selectedId]);

  async function runPreview() {
    if (!selectedId) return;
    setError('');
    setRun(null);
    setRunning(true);
    try {
      setRun(await window.desktopApi.runWorkflowPreview(selectedId));
    } catch {
      setError('Không thể chạy thử workflow.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="workflow-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">WORKFLOW RUNNER</p>
          <h2>Luồng tự động hóa</h2>
        </div>
        <button className="primary-button" type="button" onClick={runPreview} disabled={!selectedId || isRunning}>
          {isRunning ? 'Đang chạy thử...' : '▶ Chạy thử'}
        </button>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {selected && <div className="workflow-summary">
        <div>
          <span className="workflow-kicker">WORKFLOW V{selected.version}</span>
          <h3>{selected.name}</h3>
          <p>{selected.description}</p>
        </div>
        <label className="workflow-select-label">Workflow
          <select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setRun(null); }}>
            {workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
          </select>
        </label>
      </div>}

      {selected ? (
        <div className="workflow-layout">
          <div className="action-list">
            <div className="action-list-heading"><span>Action sequence</span><b>{selected.stepCount} steps</b></div>
            <WorkflowSteps steps={definition?.steps ?? []} />
          </div>
          <div className="run-log-panel">
            <div className="action-list-heading"><span>Run log</span>{run && <b className={`run-status run-${run.status}`}>{statusLabel(run.status)}</b>}</div>
            {run ? <div className="run-logs">{run.logs.map((log) => <LogRow key={`${log.step}-${log.at}`} log={log} />)}</div> : <div className="run-empty"><div className="run-empty-icon">↗</div><strong>Chưa có lần chạy</strong><p>Chạy thử để kiểm tra thứ tự action và điều kiện dừng an toàn.</p></div>}
          </div>
        </div>
      ) : <div className="empty-state"><h3>Chưa có workflow</h3><p>Workflow sẽ xuất hiện sau khi có definition hợp lệ.</p></div>}
      <ScriptRunnerPanel />
    </section>
  );
}

function WorkflowSteps({ steps }: { steps: Array<{ type: string; name?: string }> }) {
  return <div className="steps">{steps.map((step, index) => <div className="step-row" key={`${index}-${step.name}`}><span className="step-number">{String(index + 1).padStart(2, '0')}</span><span className="step-kind">{actionLabels[step.type] ?? step.type}</span><strong>{step.name}</strong>{step.type === 'stop' && <span className="safe-stop">SAFE STOP</span>}</div>)}</div>;
}

function LogRow({ log }: { log: WorkflowLog }) {
  return <div className="log-row"><span className={`log-dot log-${log.status}`} /> <div><strong>{String(log.step).padStart(2, '0')} · {log.name}</strong><p>{log.message}</p></div></div>;
}
