import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { Account, Campaign, CampaignInput, CampaignTarget, Device, WorkflowSummary } from './types';

const defaultVariables = JSON.stringify({ hotel: 'Melia Vinpearl Da Nang Riverfront', paymentPlan: 'VEC-08-25', checkIn: '2026-12-17', checkOut: '2026-12-18', rooms: 1, adults: 1, children: 0, infants: 0 }, null, 2);
const blankTarget = (): CampaignTarget => ({ deviceId: 0, accountId: 0 });

export default function CampaignPanel() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [form, setForm] = useState({ name: '', workflowId: '', status: 'draft' as Campaign['status'], variablesJson: defaultVariables, targets: [blankTarget()] });
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  const reload = async () => {
    const [campaignItems, deviceItems, accountItems, workflowItems] = await Promise.all([window.desktopApi.listCampaigns(), window.desktopApi.listDevices(), window.desktopApi.listAccounts(), window.desktopApi.listWorkflows()]);
    setCampaigns(campaignItems); setDevices(deviceItems); setAccounts(accountItems); setWorkflows(workflowItems);
    setForm((current) => ({ ...current, workflowId: current.workflowId || workflowItems[0]?.id || '' }));
  };
  useEffect(() => { void reload().catch(() => setError('Không thể đọc dữ liệu campaign.')); }, []);
  const canCreate = useMemo(() => devices.length > 0 && accounts.length > 0 && workflows.length > 0, [devices, accounts, workflows]);
  function updateTarget(index: number, patch: Partial<CampaignTarget>) { setForm((current) => ({ ...current, targets: current.targets.map((target, targetIndex) => targetIndex === index ? { ...target, ...patch } : target) })); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setResult('');
    let variables: Record<string, unknown>;
    try { const parsed: unknown = JSON.parse(form.variablesJson); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(); variables = parsed as Record<string, unknown>; } catch { setError('Campaign variables phải là JSON object hợp lệ.'); return; }
    setSaving(true);
    try {
      const input = { name: form.name, workflowId: form.workflowId, status: form.status, variables, targets: form.targets } satisfies CampaignInput;
      const campaign = editingId ? await window.desktopApi.updateCampaign({ id: editingId, campaign: input }) : await window.desktopApi.createCampaign(input);
      setCampaigns((current) => editingId ? current.map((item) => item.id === campaign.id ? campaign : item) : [campaign, ...current]);
      setForm({ name: '', workflowId: workflows[0]?.id ?? '', status: 'draft', variablesJson: defaultVariables, targets: [blankTarget()] });
      setEditingId(null); setOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu campaign.'); } finally { setSaving(false); }
  }
  async function run(campaign: Campaign) {
    setRunningId(campaign.id); setError(''); setResult('');
    try { const jobs = await window.desktopApi.runCampaign(campaign.id); setResult(`${campaign.name}: ${jobs.filter((job) => job.status === 'stopped' || job.status === 'succeeded').length}/${jobs.length} target hoàn tất.`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể chạy campaign.'); }
    finally { setRunningId(null); await reload(); }
  }
  function edit(campaign: Campaign) { setEditingId(campaign.id); setForm({ name: campaign.name, workflowId: campaign.workflowId, status: campaign.status, variablesJson: JSON.stringify(campaign.variables, null, 2), targets: campaign.targets }); setOpen(true); }

  return <section className="content-section">
    <div className="section-heading"><div><p className="eyebrow">CAMPAIGN SOURCE</p><h2>Campaigns</h2></div><button className="primary-button" type="button" disabled={!canCreate} onClick={() => { setEditingId(null); setForm({ name: '', workflowId: workflows[0]?.id ?? '', status: 'draft', variablesJson: defaultVariables, targets: [blankTarget()] }); setOpen(true); }}>+ Tạo campaign</button></div>
    {!canCreate && <div className="capability-notice">Tạo ít nhất một device, account và workflow trước khi tạo campaign.</div>}
    {error && <div className="error-banner">{error}</div>}
    {result && <div className="notice-bar"><span className="notice-icon">i</span><div>{result}</div></div>}
    {campaigns.length ? <div className="table-wrap campaign-table"><table><thead><tr><th>ID</th><th>Campaign</th><th>Workflow</th><th>Targets</th><th>Variables</th><th>Trạng thái</th><th>Cập nhật</th><th>Thao tác</th></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign.id}><td>#{campaign.id}</td><td><strong>{campaign.name}</strong></td><td><code>{workflows.find((item) => item.id === campaign.workflowId)?.name ?? campaign.workflowId}</code></td><td>{campaign.targets.length}<small>{campaign.targets.map((target) => `${devices.find((item) => item.id === target.deviceId)?.displayName ?? '?'} / ${accounts.find((item) => item.id === target.accountId)?.displayName ?? '?'}`).join(', ')}</small></td><td><code>{Object.keys(campaign.variables).join(', ') || '—'}</code></td><td><span className={`run-status run-${campaign.status === 'active' ? 'succeeded' : campaign.status === 'draft' ? 'stopped' : 'failed'}`}>{campaign.status}</span></td><td>{new Date(campaign.updatedAt).toLocaleString('vi-VN')}</td><td><div className="row-actions"><button className="secondary-button compact-button" type="button" onClick={() => edit(campaign)}>Sửa</button><button className="primary-button compact-button" type="button" disabled={campaign.status !== 'active' || runningId === campaign.id} onClick={() => void run(campaign)}>{runningId === campaign.id ? '...' : 'Chạy'}</button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><div className="empty-icon">↗</div><h3>Chưa có campaign</h3><p>Mỗi campaign có workflow, variables và danh sách cặp device-account riêng.</p></div>}
    {open && <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}><form className="modal campaign-modal" onSubmit={submit}>
      <div className="modal-heading"><div><p className="eyebrow">CAMPAIGN SETUP</p><h2>{editingId ? 'Cập nhật campaign' : 'Tạo campaign'}</h2></div><button className="close-button" type="button" onClick={() => setOpen(false)}>×</button></div>
      <label>Tên campaign<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Tìm phòng Đà Nẵng tháng 12" /></label>
      <div className="form-row"><label>Workflow<select value={form.workflowId} onChange={(event) => setForm({ ...form, workflowId: event.target.value })}>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select></label><label>Trạng thái<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Campaign['status'] })}><option value="draft">Draft</option><option value="active">Active</option><option value="archived">Archived</option></select></label></div>
      <label>Variables JSON<textarea value={form.variablesJson} onChange={(event) => setForm({ ...form, variablesJson: event.target.value })} spellCheck={false} /></label>
      <div className="targets-heading"><span>Targets: device + account</span><button className="secondary-button compact-button" type="button" onClick={() => setForm({ ...form, targets: [...form.targets, blankTarget()] })}>+ Thêm target</button></div>
      <div className="target-list">{form.targets.map((target, index) => <div className="target-row" key={index}><select required value={target.deviceId || ''} onChange={(event) => updateTarget(index, { deviceId: Number(event.target.value) })}><option value="">Chọn device</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.displayName} · {device.status}</option>)}</select><select required value={target.accountId || ''} onChange={(event) => updateTarget(index, { accountId: Number(event.target.value) })}><option value="">Chọn account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}</select><button className="icon-button" type="button" disabled={form.targets.length === 1} onClick={() => setForm({ ...form, targets: form.targets.filter((_, targetIndex) => targetIndex !== index) })}>×</button></div>)}</div>
      <p className="form-help">Một device chỉ được gán một account trong cùng campaign để không tạo job song song trên cùng iPhone.</p>
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setOpen(false)}>Hủy</button><button className="primary-button" disabled={saving} type="submit">{saving ? 'Đang lưu...' : editingId ? 'Cập nhật' : 'Lưu campaign'}</button></div>
    </form></div>}
  </section>;
}
