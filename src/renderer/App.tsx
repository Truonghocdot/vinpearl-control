import { FormEvent, useEffect, useState } from 'react';
import type { Device } from './types';
import WorkflowPanel from './WorkflowPanel';

const emptyForm = { name: '', host: '', port: 22, username: 'root' };

function statusLabel(status: Device['status']) {
  if (status === 'online') return 'Đang kết nối';
  if (status === 'offline') return 'Mất kết nối';
  return 'Chưa kiểm tra';
}

export default function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [isFormOpen, setFormOpen] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'overview' | 'workflows'>('overview');
  const [workflowCount, setWorkflowCount] = useState(0);

  useEffect(() => {
    window.desktopApi.listDevices().then(setDevices).catch(() => {
      setError('Không thể đọc danh sách thiết bị.');
    });
    window.desktopApi.listWorkflows().then((items) => setWorkflowCount(items.length)).catch(() => {
      setError('Không thể đọc workflow.');
    });
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const device = await window.desktopApi.createDevice({
        ...form,
        port: Number(form.port),
      });
      setDevices((current) => [device, ...current]);
      setForm(emptyForm);
      setFormOpen(false);
    } catch {
      setError('Không thể lưu thiết bị. Kiểm tra lại dữ liệu.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div>
            <strong>Vinpearl</strong>
            <span>Device Manager</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Điều hướng chính">
          <button className={`nav-item ${view === 'overview' ? 'active' : ''}`} type="button" onClick={() => setView('overview')}>⌂ <span>Tổng quan</span></button>
          <button className={`nav-item ${view === 'overview' ? '' : ''}`} type="button" onClick={() => setView('overview')}>▣ <span>Thiết bị</span><b>{devices.length}</b></button>
          <button className={`nav-item ${view === 'workflows' ? 'active' : ''}`} type="button" onClick={() => setView('workflows')}>↗ <span>Workflows</span></button>
          <button className="nav-item disabled" type="button">◷ <span>Lịch chạy</span></button>
          <button className="nav-item disabled" type="button">≡ <span>Nhật ký</span></button>
        </nav>
        <div className="sidebar-footer">
          <span className="connection-dot" /> Local workspace
          <small>SSH service chưa kết nối</small>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">WORKSPACE / {view === 'workflows' ? 'WORKFLOWS' : 'TỔNG QUAN'}</p>
            <h1>{view === 'workflows' ? 'Luồng tự động hóa' : 'Quản lý thiết bị'}</h1>
          </div>
          <div className="topbar-meta">
            <span className="environment-tag">LOCAL</span>
            <div className="avatar">OP</div>
          </div>
        </header>

        {view === 'workflows' ? <WorkflowPanel /> : <>
        <section className="stats-grid" aria-label="Tổng quan hệ thống">
          <div className="stat-card"><span>Tổng thiết bị</span><strong>{devices.length}</strong><small>Đã khai báo trong workspace</small></div>
          <div className="stat-card"><span>Đang hoạt động</span><strong>0</strong><small>Chưa chạy SSH health check</small></div>
          <div className="stat-card"><span>Workflow</span><strong>{workflowCount}</strong><small>Workflow đã seed trong workspace</small></div>
          <div className="stat-card"><span>Job hôm nay</span><strong>0</strong><small>Chưa có lịch chạy</small></div>
        </section>

        <section className="content-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">DEVICE INVENTORY</p>
              <h2>Thiết bị iPhone</h2>
            </div>
            <button className="primary-button" type="button" onClick={() => setFormOpen(true)}>+ Thêm thiết bị</button>
          </div>

          {error && <div className="error-banner" role="alert">{error}</div>}
          {devices.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">▣</div>
              <h3>Chưa có thiết bị nào</h3>
              <p>Thêm iPhone đầu tiên để bắt đầu xác minh kết nối SSH.</p>
              <button className="secondary-button" type="button" onClick={() => setFormOpen(true)}>Thêm thiết bị đầu tiên</button>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Thiết bị</th><th>Endpoint</th><th>Trạng thái</th><th>Kiểm tra gần nhất</th><th /></tr></thead>
                <tbody>{devices.map((device) => (
                  <tr key={device.id}>
                    <td><strong>{device.name}</strong><small>{device.username}</small></td>
                    <td><code>{device.host}:{device.port}</code></td>
                    <td><span className={`status status-${device.status}`}><i />{statusLabel(device.status)}</span></td>
                    <td>{device.lastCheckedAt ? new Date(device.lastCheckedAt).toLocaleString('vi-VN') : 'Chưa kiểm tra'}</td>
                    <td><button className="icon-button" type="button" title="Mở chi tiết">•••</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>

        <section className="notice-bar">
          <span className="notice-icon">i</span>
          <div><strong>MVP đang ở bước Device Manager.</strong><span>SSH host key verification và health check sẽ được tích hợp ở phase tiếp theo.</span></div>
        </section>
        </>}
      </main>

      {isFormOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setFormOpen(false); }}>
        <form className="modal" onSubmit={handleSubmit}>
          <div className="modal-heading"><div><p className="eyebrow">DEVICE SETUP</p><h2>Thêm thiết bị</h2></div><button className="close-button" type="button" onClick={() => setFormOpen(false)} aria-label="Đóng">×</button></div>
          <label>Tên hiển thị<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="iPhone 01" /></label>
          <div className="form-row"><label>Địa chỉ IP / hostname<input required value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} placeholder="192.168.1.20" /></label><label>Port<input required type="number" min="1" max="65535" value={form.port} onChange={(event) => setForm({ ...form, port: Number(event.target.value) })} /></label></div>
          <label>SSH username<input required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
          <p className="form-help">Private key và host fingerprint sẽ được bổ sung qua credential flow, không lưu trực tiếp trong SQLite.</p>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setFormOpen(false)}>Hủy</button><button className="primary-button" disabled={isSaving} type="submit">{isSaving ? 'Đang lưu...' : 'Lưu thiết bị'}</button></div>
        </form>
      </div>}
    </div>
  );
}
