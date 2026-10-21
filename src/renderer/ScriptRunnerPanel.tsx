import { useState } from 'react';
import type { LocationInput, ScriptLocationResult, VinClubScriptInput, VinClubScriptResult } from './types';

const newLocation = (): LocationInput => ({
  name: 'Melia Vinpearl Da Nang Riverfront',
  checkIn: '2026-12-17',
  checkOut: '2026-12-18',
  rooms: 1,
  adults: 1,
  children: 0,
  infants: 0,
});

export default function ScriptRunnerPanel() {
  const [input, setInput] = useState<VinClubScriptInput>({
    credentialRef: 'vinclub-default',
    paymentPlan: 'VEC-08-25',
    locations: [newLocation()],
  });
  const [result, setResult] = useState<VinClubScriptResult | null>(null);
  const [error, setError] = useState('');
  const [isRunning, setRunning] = useState(false);

  function updateLocation(index: number, patch: Partial<LocationInput>) {
    setInput((current) => ({
      ...current,
      locations: current.locations.map((location, locationIndex) => locationIndex === index ? { ...location, ...patch } : location),
    }));
  }

  async function runScript() {
    setError('');
    setResult(null);
    setRunning(true);
    try {
      setResult(await window.desktopApi.runVinClubScript(input));
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Không thể chạy script.');
    } finally {
      setRunning(false);
    }
  }

  return <section className="script-section">
    <div className="section-heading">
      <div><p className="eyebrow">SCRIPT INPUT</p><h2>Chạy nhiều địa điểm</h2></div>
      <button className="primary-button" type="button" onClick={runScript} disabled={isRunning}>{isRunning ? 'Đang chạy...' : '▶ Chạy script'}</button>
    </div>
    <div className="script-card">
      <div className="script-top-fields">
        <label>Credential reference<input value={input.credentialRef ?? ''} onChange={(event) => setInput({ ...input, credentialRef: event.target.value })} placeholder="vinclub-default" /></label>
        <label>Mã thanh toán<input value={input.paymentPlan ?? ''} onChange={(event) => setInput({ ...input, paymentPlan: event.target.value })} placeholder="VEC-08-25" /></label>
      </div>
      <p className="form-help">Mỗi địa điểm chạy tuần tự trong cùng script. Credential reference chỉ là tên tham chiếu, không phải password.</p>
      <div className="locations-heading"><span>Danh sách địa điểm</span><button className="secondary-button compact-button" type="button" onClick={() => setInput({ ...input, locations: [...input.locations, newLocation()] })}>+ Thêm địa điểm</button></div>
      <div className="location-list">{input.locations.map((location, index) => <LocationRow key={index} index={index} location={location} canRemove={input.locations.length > 1} onChange={updateLocation} onRemove={() => setInput({ ...input, locations: input.locations.filter((_, locationIndex) => locationIndex !== index) })} />)}</div>
      {error && <div className="error-banner script-error" role="alert">{error}</div>}
      {result && <ScriptResult result={result} />}
    </div>
  </section>;
}

function LocationRow({ index, location, canRemove, onChange, onRemove }: { index: number; location: LocationInput; canRemove: boolean; onChange: (index: number, patch: Partial<LocationInput>) => void; onRemove: () => void }) {
  return <div className="location-row">
    <div className="location-number">{String(index + 1).padStart(2, '0')}</div>
    <label className="location-name">Khách sạn<input value={location.name} onChange={(event) => onChange(index, { name: event.target.value })} /></label>
    <label>Nhận phòng<input type="date" value={location.checkIn} onChange={(event) => onChange(index, { checkIn: event.target.value })} /></label>
    <label>Trả phòng<input type="date" value={location.checkOut} onChange={(event) => onChange(index, { checkOut: event.target.value })} /></label>
    <label>Phòng<input type="number" min="1" max="20" value={location.rooms} onChange={(event) => onChange(index, { rooms: Number(event.target.value) })} /></label>
    <label>Người lớn<input type="number" min="1" max="50" value={location.adults} onChange={(event) => onChange(index, { adults: Number(event.target.value) })} /></label>
    <label>Trẻ em<input type="number" min="0" max="50" value={location.children} onChange={(event) => onChange(index, { children: Number(event.target.value) })} /></label>
    <label>Em bé<input type="number" min="0" max="50" value={location.infants} onChange={(event) => onChange(index, { infants: Number(event.target.value) })} /></label>
    <button className="icon-button remove-location" type="button" disabled={!canRemove} onClick={onRemove} title="Xóa địa điểm" aria-label={`Xóa địa điểm ${index + 1}`}>×</button>
  </div>;
}

function ScriptResult({ result }: { result: VinClubScriptResult }) {
  return <div className="script-result"><div className="script-result-heading"><strong>Kết quả chạy script</strong><span className={`run-status run-${result.status}`}>{result.completedLocations}/{result.totalLocations} hoàn tất</span></div><div className="script-result-list">{result.results.map((item) => <LocationResult key={item.workflowId} result={item} />)}</div></div>;
}

function LocationResult({ result }: { result: ScriptLocationResult }) {
  const lastLog = result.logs.at(-1);
  return <div className="location-result"><span className={`log-dot log-${result.status}`} /><div><strong>{result.location.name}</strong><p>{result.location.checkIn} → {result.location.checkOut} · {result.logs.length} action · {lastLog?.message ?? 'Không có log'}</p></div></div>;
}
