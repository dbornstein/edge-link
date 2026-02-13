import React, { useState, useEffect, useMemo } from 'react';
import { CL } from './ui/Theme';
import { Button, Switch } from './ui/Primitive';
import { API } from '../api/videonApi';
import { ago, nextTok } from '../utils/helpers';

// Alerts Component
// Displays a list of alerts for all devices, allowing the user to filter by silenced status.
// Users can also silence/unsilence alerts or close them.
export default function Alerts({ jwt, orgGuid, rows, safeMode, onWriteBlocked }) {
  const [sil, setSil] = useState(false); // Filter: Show silenced alerts
  const [items, setItems] = useState([]); // List of alert objects
  const [next, setNext] = useState(null); // Pagination token
  const [err, setErr] = useState("");
  const ids = rows.map(r => r.id);

  // Fetch alerts when dependencies change
  useEffect(() => {
    const load = async () => {
      try {
        const r = await API.deviceAlerts(jwt, orgGuid, ids, { silenced: sil, size: 20 });
        setItems(r.alerts || []); setNext(nextTok(r));
      } catch (e) { setErr(String(e.message || e)); }
    };
    load();
  }, [jwt, orgGuid, JSON.stringify(ids), sil]);

  // Generate local alerts for offline devices
  const localAlerts = useMemo(() => {
    if (sil) return []; // Do not show active offline alerts if viewing silenced
    return rows.filter(r => r.status === 'offline').map(r => ({
      alert_guid: `local-offline-${r.id}`,
      device_guid: r.id,
      timestamp: r.lastSeen === 'now' ? new Date().toISOString() : (r.lastAt ? new Date(r.lastAt).toISOString() : new Date().toISOString()),
      alert_type: "State",
      name: "Device Offline",
      label: "offline",
      silenced: false,
      isLocal: true
    }));
  }, [rows, sil]);

  // Load next page of alerts
  const more = async () => {
    if (!next) return;
    try {
      const r = await API.deviceAlerts(jwt, orgGuid, ids, { silenced: sil, size: 20, token: next });
      setItems(x => [...x, ...(r.alerts || [])]); setNext(nextTok(r));
    } catch (e) { setErr(String(e.message || e)); }
  };

  const nameOf = id => rows.find(r => r.id === id)?.name || id;

  const displayItems = [...localAlerts, ...items];

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-2"><Switch checked={sil} onChange={setSil} /><span className={CL.muted}>Show silenced</span></div>
        <div className={"ml-auto " + CL.muted}>{displayItems.length} alerts</div>
      </div>
      
      {err && <div className="text-sm text-red-400">Error: {err}</div>}
      
      {/* Alert Table */}
      <table className="w-full border-separate border-spacing-y-2 text-sm">
        <thead className={CL.muted}><tr><th className={CL.th}>DEVICE</th><th className={CL.th}>ALERT</th><th className={CL.th}>AGE</th><th className={CL.th}>STATUS</th></tr></thead>
        <tbody>
          {displayItems.map(a => (
            <tr key={a.alert_guid} className={CL.row}>
              <td className={CL.cell}>{nameOf(a.device_guid)}</td>
              <td className={CL.cell}>{a.name || a.label || a.alert_type}</td>
              <td className={CL.cell}>{ago(a.timestamp)}</td>
              <td className={CL.cell}>{a.silenced ? "Silenced" : "Active"}</td>
            </tr>
          ))}
          {!displayItems.length && <tr><td colSpan={4} className="px-2 py-3 text-zinc-400">No alerts.</td></tr>}
        </tbody>
      </table>
      {next && <div className="flex justify-center"><Button onClick={more}>Load more</Button></div>}
    </div>
  );
}