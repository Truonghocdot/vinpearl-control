import { useEffect, useState } from 'react';
import CampaignPanel from './CampaignPanel';
import DevicePanel from './DevicePanel';
import type { Campaign, Device } from './types';

type View = 'devices' | 'campaigns';
const viewTitle: Record<View, string> = { devices: 'Thiết bị iPhone', campaigns: 'Campaigns' };

export default function App() {
  const [view, setView] = useState<View>('devices'); const [counts, setCounts] = useState({ devices: 0, campaigns: 0 });
  useEffect(() => { Promise.all([window.desktopApi.listDevices(), window.desktopApi.listCampaigns()]).then(([devices, campaigns]: [Device[], Campaign[]]) => setCounts({ devices: devices.length, campaigns: campaigns.length })).catch(() => undefined); }, [view]);
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark">V</div><div><strong>Vinpearl</strong><span>Automation Console</span></div></div><nav className="nav-list" aria-label="Điều hướng chính"><button className={`nav-item ${view === 'devices' ? 'active' : ''}`} type="button" onClick={() => setView('devices')}>▣ <span>Thiết bị</span><b>{counts.devices}</b></button><button className={`nav-item ${view === 'campaigns' ? 'active' : ''}`} type="button" onClick={() => setView('campaigns')}>↗ <span>Campaigns</span><b>{counts.campaigns}</b></button></nav><div className="sidebar-footer"><span className="connection-dot" /> Appium local<small>127.0.0.1:4723 · USB devices</small></div></aside><main className="main-content"><header className="topbar"><div><p className="eyebrow">MACOS WORKSPACE / {view.toUpperCase()}</p><h1>{viewTitle[view]}</h1></div><div className="topbar-meta"><span className="environment-tag">MACOS</span><div className="avatar">OP</div></div></header>{view === 'devices' && <DevicePanel />}{view === 'campaigns' && <CampaignPanel />}</main></div>;
}
