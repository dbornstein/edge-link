import React, { useEffect, useMemo, useRef, useState } from "react";

// --- IMPORT MODULES ---
import { auth, ago, uid, sleep, nextTok, parseOutputMetrics } from './utils/helpers';
import { demoDevices, demoAllAlerts } from './api/mockData';
import { API } from './api/videonApi';
import { buildTellyoChannelPayload } from './utils/tellyoUtils';
import { CL } from './components/ui/Theme';
import { Button, Switch, Drawer, Modal, ChevronIcon, Icon } from './components/ui/Primitive';
import InputsPage from './components/InputsPage';
import Alerts from './components/Alerts';
import Settings from './components/Settings';
import Detail from './components/Detail';
// -------------------

const OUTPUT_CONFIRM_DELAYS = [300, 600, 1200];

// =================== Main ===================
// Default application settings. These serve as a baseline for new users.
const initialSettings = {
  jwt: "",
  orgGuid: "",
  base: "",
  bearer: "",
  safeMode: false,
  bypassVideonError: false,
  rememberSecrets: true,
  pollRate: 50000,
  accent: "#f97316",
  tellyo: { apiEndpoint: "", apiVersion: "v2", organizationId: "", token: "" },
  cloudport: { release: "CP_3.31.x+", baseHost: "", userAuthToken: "" },
};

export default function App() {
  // --- Global State ---
  const [settings, setSettings] = useState(initialSettings);
  // 'draftSettings' is used in the Settings view to allow editing without immediately applying changes.
  const [draftSettings, setDraftSettings] = useState(null);

  // 'rows' contains the list of devices fetched from the API.
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(new Set()); // Selected device IDs for bulk actions
  const [toast, setToast] = useState("");
  const [view, setView] = useState("devices"); // Current view: devices, alerts, inputs, settings
  const [detOpen, setDetOpen] = useState(false); // Detail drawer open state
  const [detDev, setDetDev] = useState(null); // Currently selected device for details
  const [utc, setUtc] = useState(new Date().toISOString().slice(11, 19));
  
  // UI preferences
  const [embed, setEmbed] = useState(false);
  const [compact, setCompact] = useState(false);
  const [q, setQ] = useState(""); // Search query
  const [sort, setSort] = useState("status"); // Sort order
  
  // Alerts badge state
  const [badge, setBadge] = useState(0);
  const [badgeMore, setBadgeMore] = useState(false);
  
  // Input profiles
  const [profiles, setProfiles] = useState([]);
  
  // Local name overrides to persist across reloads if API doesn't save them
  const [localNames, setLocalNames] = useState(() => {
    try { return JSON.parse(localStorage.getItem("lec.localNames") || "{}"); } catch { return {}; }
  });

  // Connectivity test status for settings page
  const [testStatus, setTestStatus] = useState({
    videon: { state: 'idle', message: '' },
    cloudport: { state: 'idle', message: '' },
    tellyo: { state: 'idle', message: '' },
  });

  const { jwt, orgGuid, base, bearer, safeMode, rememberSecrets, pollRate, accent, tellyo, cloudport } = settings;

  // --- Helper Functions ---

  const setTestResult = (key, state, message = "") =>
    setTestStatus(prev => ({ ...prev, [key]: { state, message } }));

  // Tests connection to external services (Videon, Cloudport, Tellyo)
  const runTest = async (key) => {
    setTestResult(key, 'pending');
    const s = draftSettings || settings;
    try {
      if (key === 'videon') {
        if (!s.jwt) throw new Error('Provide an access token first.');
        const res = await API.listDevices(s.jwt, s.orgGuid);
        const devices = Array.isArray(res?.devices) ? res.devices : Array.isArray(res) ? res : [];
        setTestResult(key, 'success', devices.length ? `${devices.length} devices` : 'Connection OK');
      } else if (key === 'cloudport') {
        if (!s.cloudport.baseHost || !s.cloudport.userAuthToken) throw new Error('Set base host and auth token first.');
        const data = await API.testCloudport(s.cloudport);
        const total = Array.isArray(data?.ingests) ? data.ingests.length : Array.isArray(data) ? data.length : undefined;
        setTestResult(key, 'success', typeof total === 'number' ? `${total} ingests` : 'Connection OK');
      } else if (key === 'tellyo') {
        if (!s.tellyo.apiEndpoint || !s.tellyo.token) throw new Error('Set endpoint and Tellyo-Token first.');
        const result = await API.testTellyo(s.tellyo);
        setTestResult(key, 'success', result.message || 'Connection OK');
      } else {
        setTestResult(key, 'error', 'Unknown test');
      }
    } catch (err) {
      setTestResult(key, 'error', err?.message || String(err));
    }
  };

  const handleWriteBlocked = () => setToast("Safe Mode is enabled. Disable it in Settings to allow writes.");

  // --- Effects ---

  // Apply accent color and run the UTC clock
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
    const t = setInterval(() => setUtc(new Date().toISOString().slice(11, 19)), 1000);
    return () => clearInterval(t);
  }, [accent]);

  // Handle embedded mode (e.g., inside an iframe) via URL parameter
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const e = p.get("embed");
    if (e === "1" || e === "true") { setEmbed(true); setCompact(true); }
  }, []);

  // Load settings from LocalStorage and SessionStorage on mount
  useEffect(() => {
    try {
      const loaded = { ...initialSettings };
      const remember = localStorage.getItem("lec.remember") === "1";
      loaded.rememberSecrets = remember;

      const sess = JSON.parse(sessionStorage.getItem("lec.session") || "{}");

      loaded.jwt = sess.jwt || (remember ? localStorage.getItem("lec.jwt") : '') || '';
      loaded.bearer = sess.bearer || (remember ? localStorage.getItem("lec.cfgBearer") : '') || '';
      
      const tellyoStore = localStorage.getItem("lec.tellyo");
      if (tellyoStore) {
        const parsed = JSON.parse(tellyoStore);
        loaded.tellyo = {
          apiEndpoint: parsed.apiEndpoint || parsed.base || "",
          apiVersion: parsed.apiVersion || parsed.version || "v2",
          organizationId: parsed.organizationId != null ? String(parsed.organizationId) : "",
          token: sess.tellyoToken || (remember ? parsed.token : "") || "",
        };
      }
      
      const cloudportStore = localStorage.getItem("lec.cloudport");
      if (cloudportStore) {
        const parsed = JSON.parse(cloudportStore);
        loaded.cloudport = {
          release: parsed.release || parsed.version || "CP_3.31.x+",
          baseHost: parsed.baseHost || parsed.base || "",
          userAuthToken: sess.cloudportToken || (remember ? parsed.userAuthToken : "") || "",
        };
      }
      
      loaded.orgGuid = localStorage.getItem("lec.org") || "";
      loaded.base = localStorage.getItem("lec.base") || "";
      loaded.accent = localStorage.getItem("lec.accent") || "#f97316";
      loaded.safeMode = localStorage.getItem("lec.safeMode") !== "0"; // default true
      loaded.bypassVideonError = localStorage.getItem("lec.bypassVideonError") === "true";
      loaded.pollRate = Number(localStorage.getItem("lec.pollRate")) || 5000;
      
      const P = localStorage.getItem("lec.profiles"); if (P) setProfiles(JSON.parse(P));
      const C = localStorage.getItem("lec.compact"); if (C === "1") setCompact(true);

      setSettings(loaded);
    } catch {}
  }, []);

  // Persist settings to LocalStorage/SessionStorage whenever they change
  useEffect(() => {
    try {
      const { rememberSecrets, tellyo, cloudport, ...rest } = settings;
      localStorage.setItem("lec.remember", rememberSecrets ? "1" : "0");
      
      for(const k in rest) localStorage.setItem(`lec.${k}`, rest[k]);
      
      // Store public parts of config in LocalStorage, secrets in SessionStorage unless "Remember Secrets" is on.
      const tellyoToStore = { ...tellyo, token: "" };
      const cloudportToStore = { ...cloudport, userAuthToken: "" };
      localStorage.setItem("lec.tellyo", JSON.stringify(tellyoToStore));
      localStorage.setItem("lec.cloudport", JSON.stringify(cloudportToStore));

      if (rememberSecrets) {
        localStorage.setItem("lec.jwt", settings.jwt);
        localStorage.setItem("lec.cfgBearer", settings.bearer);
        localStorage.setItem("lec.tellyo", JSON.stringify(settings.tellyo));
        localStorage.setItem("lec.cloudport", JSON.stringify(settings.cloudport));
      } else {
        localStorage.removeItem("lec.jwt");
        localStorage.removeItem("lec.cfgBearer");
      }
      sessionStorage.setItem("lec.session", JSON.stringify({
        jwt: settings.jwt,
        bearer: settings.bearer,
        tellyoToken: settings.tellyo.token,
        cloudportToken: settings.cloudport.userAuthToken,
      }));

      localStorage.setItem("lec.compact", compact ? "1" : "0");
      localStorage.setItem("lec.profiles", JSON.stringify(profiles));
    } catch {}
  }, [settings, compact, profiles]);


  // Draft settings management: Prompt user if they try to leave Settings with unsaved changes.
  useEffect(() => {
    if (view === 'settings') {
      if (draftSettings === null) {
        setDraftSettings(settings);
      }
    } else {
      if (draftSettings !== null) {
        if (JSON.stringify(settings) !== JSON.stringify(draftSettings)) {
          if (!confirm("You have unsaved changes. Are you sure you want to discard them?")) {
            setView('settings'); // force user to stay on settings
            return;
          }
        }
        setDraftSettings(null);
      }
    }
  }, [view, settings, draftSettings]);

  // Polling: Update Alerts badge count every 10 seconds
  useEffect(() => {
    const ids = rows.map(r => r.id);
    let ti;
    const go = async () => {
      try {
        if (jwt && !ids.length) { setBadge(0); setBadgeMore(false); return; }
        const r = await API.deviceAlerts(jwt, orgGuid, ids, { silenced: false, size: 20 });
        setBadge((r.alerts || []).length); setBadgeMore(!!nextTok(r));
      } catch { setBadge(0); setBadgeMore(false); }
    };
    go(); ti = setInterval(go, 10000);
    return () => clearInterval(ti);
  }, [jwt, orgGuid, JSON.stringify(rows.map(r => r.id))]);

  // Polling: Update Device List and State every 'pollRate' ms
  // This fetches the list of devices, then fetches state and shadows for each device in parallel.
  useEffect(() => {
    let t, busy = false, alive = true;
    const load = async () => {
      if (busy || !alive) return; busy = true;
      try {
        const list = await API.listDevices(jwt, orgGuid);
        const fromApi = (list?.devices || list || []).map(d => ({
          id: d.device_guid,
          apiName: d.display_name || d.name || d.device_guid,
          ip: d.public_ip || d.external_ip || d.ip_address || null, // Prefer public/external IP
          localIp: d.ip_address || null // Keep local IP separately just in case
        }));

        // Fetch state and shadows for all devices to show status indicators and bitrate.
        const [deviceStates, deviceShadows] = await Promise.all([
          Promise.all(fromApi.map(d => API.deviceState(jwt, orgGuid, d.id).catch(() => null))),
          Promise.all(fromApi.map(d => API.deviceShadows(jwt, orgGuid, d.id).catch(() => null))),
        ]);

        setRows(prev => {
          const byId = new Map(prev.map(r => [r.id, r]));
          const now = Date.now();
          
          // Map over the devices list, merging in the latest state and shadow data.
          // We prioritize the 'external_ip' found in the device state (stateData) as the most reliable
          // public IP source for constructing stream URLs (e.g. for Tellyo).
          return fromApi.map(({ id, apiName, ip: listIp, localIp }, index) => {
            const old = byId.get(id);
            let name = apiName;
            
            // Apply local override if present, otherwise fall back to runtime memory if API returns GUID
            if (localNames[id]) name = localNames[id];
            else if (name === id && old?.name && old.name !== id) name = old.name;

            // Prevent UI jumping if a rename is in progress locally
            if (old?.lockNameUntil && old.lockNameUntil > now) name = old.name;

            const stateData = deviceStates[index]?.state || {};
            const isOnline = !!stateData.online;
            
            // Determine the best IP address to use:
            // 1. 'external_ip' from real-time state (most accurate/up-to-date)
            // 2. 'ip' from the initial list response (fallback)
            // 3. null (if neither are available)
            const ip = stateData.external_ip || listIp || null;

            const shadowData = deviceShadows[index]?.shadows || deviceShadows[index];
            const outputMetrics = parseOutputMetrics(shadowData);
            const srtRunning = outputMetrics.some(metric => metric.type === 'srt' && metric.status === 'RUNNING');

            const lastISO = stateData.last_state_update || (srtRunning ? new Date().toISOString() : null);
            const lastAt = lastISO ? Date.parse(lastISO) : 0;
            const kb = +(stateData.encoder?.video?.bitrate_kbps ?? stateData.video?.bitrate_kbps ?? stateData.metrics?.video?.bitrate_kbps ?? 0);

            const existing = old || {};
            // Return the merged device object with the correct 'ip' property.
            return { ...existing, id, name, ip, localIp, status: isOnline ? (srtRunning ? "running" : "stopped") : "offline", lastSeen: lastISO ? ago(lastISO) : "-", lastAt, bitrateKbps: kb };
          });
        });
      } catch (e) {
        // If no JWT, show demo mode. Otherwise, show error.
        if (!jwt) {
          setRows(demoDevices().map(d => ({ id: d.device_guid, name: d.display_name || d.serial_number, status: Math.random() > 0.5 ? "running" : "stopped", lastSeen: "now" })));
        }
        else {
          setRows([]); setToast("Devices: " + String(e?.message || e));
        }
      } finally { busy = false; }
    };
    load(); t = setInterval(load, pollRate);
    return () => { alive = false; clearInterval(t); };
  }, [jwt, orgGuid, pollRate, localNames]);

  // Table sorting and filtering logic
  const vRows = useMemo(() => {
    let a = rows.filter(r => !q || (r.name || "").toLowerCase().includes(q.toLowerCase()) || (r.id || "").toLowerCase().includes(q.toLowerCase()));
    if (sort === "name") a.sort((x, y) => (x.name || "").localeCompare(y.name || ""));
    else if (sort === "last") a.sort((x, y) => (y.lastAt || 0) - (x.lastAt || 0));
    else a.sort((x, y) => (y.status === "running") - (x.status === "running") || (y.lastAt || 0) - (x.lastAt || 0));
    return a;
  }, [rows, q, sort]);

  const allSel = useMemo(() => vRows.length && vRows.every(r => sel.has(r.id)), [vRows, sel]);
  const toggleAll = () => setSel(s => { const n = new Set(s); if (allSel) vRows.forEach(r => n.delete(r.id)); else vRows.forEach(r => n.add(r.id)); return n; });
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const collapsed = compact || embed;

  return (
    <div className="h-full bg-zinc-950 text-zinc-100">
      <div className={`grid h-full ${collapsed ? "grid-cols-[64px_1fr] grid-rows-[56px_1fr]" : "grid-cols-[260px_1fr] grid-rows-[56px_1fr]"}`}>
        {/* Header */}
        <header className="col-span-2 row-start-1 flex items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-3">
          <div className="font-semibold">Amagi EDGE LINK</div>
          <span className="text-xs px-2 py-1 rounded-full border border-zinc-700 bg-zinc-900">UTC {utc}</span>
          <div className="ml-auto flex items-center gap-2 text-sm">
            {safeMode && <span className="text-xs px-2 py-1 rounded-full border border-red-500/40 bg-red-500/10 text-red-300">Safe Mode</span>}
            
          </div>
        </header>

        {/* Sidebar */}
        <aside className={`flex flex-col border-r border-zinc-800 bg-zinc-900 ${collapsed ? "w-16" : "w-[260px]"}`}>
          <nav className="p-2 grow">
            {[
              { k: "devices", label: "Devices", icon: "devices" },
              { k: "alerts",  label: "Alerts",  icon: "bell", badge: badge ? (badge > 99 ? "99+" : badge + (badgeMore ? "+" : "")) : "" },
              { k: "inputs",  label: "Inputs",  icon: "inputs" },
              { k: "settings",label: "Settings",icon: "settings" },
            ].map(i => (
              <div key={i.k} onClick={() => setView(i.k)} title={collapsed ? i.label : ""} className={`mt-1 flex items-center ${view===i.k?"bg-orange-500/10 text-zinc-100":"text-zinc-400 hover:text-zinc-200"} rounded-lg px-2 py-2 cursor-pointer`}>
                <Icon name={i.icon} />
                {!collapsed && <span className="ml-2">{i.label}</span>}
                {!!i.badge && <span className="ml-auto rounded-full bg-red-500/90 text-black text-[11px] leading-none px-2 py-1">{i.badge}</span>}
              </div>
            ))}
          </nav>
          <div className="p-2 border-t border-zinc-800">
            <div onClick={() => setCompact(v => !v)} className="cursor-pointer flex items-center justify-center p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100">
              <ChevronIcon collapsed={collapsed} />
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="overflow-auto p-3">
          {view === "settings" && draftSettings ? (
            <Settings
              settings={draftSettings}
              setSettings={setDraftSettings}
              onSave={() => {
                setSettings(draftSettings);
                setToast("Settings saved.");
              }}
              onDiscard={() => {
                setDraftSettings(settings);
                setToast("Changes discarded.");
              }}
              hasChanges={draftSettings && JSON.stringify(settings) !== JSON.stringify(draftSettings)}
              testStatus={testStatus}
              onRunTest={runTest}
            />
          ) : view === "alerts" ? (
            <Alerts jwt={jwt} orgGuid={orgGuid} rows={rows} safeMode={safeMode} onWriteBlocked={handleWriteBlocked} />
          ) : view === "inputs" ? (
            <InputsPage rows={rows} profiles={profiles} setProfiles={setProfiles} />
          ) : (
            // Default View: Device List
            <>
              <div className="mb-2 flex items-center gap-2">
                <input placeholder="Search devices..." value={q} onChange={e => setQ(e.target.value)} className={"w-full max-w-xs " + CL.inp + " px-3 py-2 text-sm"} />
                <select value={sort} onChange={e => setSort(e.target.value)} className={CL.inp + " px-2 py-2 text-sm"}>
                  <option value="status">Sort: Status</option>
                  <option value="last">Sort: Last Seen</option>
                  <option value="name">Sort: Name</option>
                </select>
              </div>
              <table className="w-full border-separate border-spacing-y-2 text-sm">
                <thead className={CL.muted}>
                  <tr>
                    <th className={"px-2 text-left"}><input type="checkbox" checked={!!allSel} onChange={toggleAll} /></th>
                    <th className={"px-2 text-left"}>DEVICE</th>
                    <th className={"px-2 text-left"}>STATUS</th>
                    <th className={"px-2 text-left"}>BITRATE</th>
                    <th className={"px-2 text-left"}>LAST SEEN</th>
                    <th className={"px-2 text-left"}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {vRows.map(d => (
                    <tr key={d.id} className={CL.row}>
                      <td className={CL.cell}><input type="checkbox" checked={sel.has(d.id)} onChange={() => toggle(d.id)} /></td>
                      <td className={CL.cell + " font-medium"}>{d.name}</td>
                      <td className={CL.cell}>
                        <span className="inline-flex items-center gap-2">
                          {d.status === "running" ? <span className="h-2 w-2 rounded-full bg-green-500" /> : d.status === "stopped" ? <span className="h-2 w-2 rounded-full bg-red-500" /> : <span className="h-2 w-2 rounded-full bg-zinc-500" title="Offline" />}
                          {d.status[0].toUpperCase() + d.status.slice(1)}
                        </span>
                        </td>
                      <td className={CL.cell + " font-medium"}>
                        {d.bitrateKbps ? <span className="ml-2 text-xs text-zinc-400">{(d.bitrateKbps / 1000).toFixed(2)} Mbps</span> : null}
                      </td>
                      <td className={CL.cell}>{d.lastSeen}</td>
                      <td className={CL.cell}>
                        <Button onClick={() => { setDetDev(d); setDetOpen(true); }}>Details</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </main>
      </div>

      {/* Device Details Drawer */}
      <Detail
        open={detOpen}
        onClose={() => setDetOpen(false)}
        device={rows.find(r => r.id === detDev?.id) || detDev}
        jwt={jwt}
        orgGuid={orgGuid}
        profiles={profiles}
        setProfiles={setProfiles}
        onRename={(id, newName) => {
          setLocalNames(prev => {
            const next = { ...prev, [id]: newName };
            localStorage.setItem("lec.localNames", JSON.stringify(next));
            return next;
          });
          setRows(prev => prev.map(r => (r.id === id ? { ...r, name: newName, lockNameUntil: Date.now() + 5000 } : r)));
        }}
        safeMode={safeMode}
        bypassVideonError={settings.bypassVideonError}
        onWriteBlocked={handleWriteBlocked}
        cloudportSettings={cloudport}
        tellyoSettings={tellyo}
        setToast={setToast}
        pollRate={pollRate}
      />

      {toast && <div className={CL.toast} onClick={() => setToast("")}>{toast}</div>}
      <div className="fixed bottom-3 right-3 text-xs text-zinc-500">
        Version: 15
      </div>
    </div>
  );
}