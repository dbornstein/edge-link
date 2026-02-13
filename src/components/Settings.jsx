import React from 'react';
import { CL } from './ui/Theme';
import { Button, Switch } from './ui/Primitive';

// Settings Component
// Allows the user to configure API keys, endpoints, and application preferences.
// It also provides buttons to test the connectivity of the configured services.
export default function Settings({ settings, setSettings, onSave, onDiscard, hasChanges, testStatus, onRunTest }) {
  const { jwt, orgGuid, base, bearer, accent, safeMode, bypassVideonError, rememberSecrets, tellyo, cloudport, pollRate } = settings;
  
  // Helper to update top-level settings
  const set = (key, value) => setSettings(s => ({ ...s, [key]: value }));
  // Helpers for nested settings objects
  const setCloudport = (c) => set('cloudport', c);
  const setTellyo = (t) => set('tellyo', t);

  // Helper to display the status of a connectivity test
  const statusOf = key => {
    const entry = testStatus?.[key];
    if (!entry) return "";
    if (entry.state === 'pending') return 'Testing...';
    if (entry.state === 'success') return entry.message ? `OK (${entry.message})` : 'OK';
    if (entry.state === 'error') return `Error: ${entry.message}`;
    return "";
  };
  const isBusy = key => testStatus?.[key]?.state === 'pending';

  return (
    <div className="space-y-3">
      {/* Videon Cloud Settings */}
      <div className={CL.card}>
        <div className="mb-2 flex items-center justify-between"><div className="font-semibold">Videon Cloud API</div><div className="flex items-center gap-2 text-xs"><span className={CL.muted}>{statusOf('videon')}</span><Button onClick={() => onRunTest('videon')} disabled={isBusy('videon') || !jwt}>{isBusy('videon') ? 'Testing...' : 'Test'}</Button></div></div>
        <div className="space-y-2">
          <div><div className="text-xs text-zinc-400">Access Token</div><textarea value={jwt} onChange={e => set('jwt', e.target.value)} rows={3} className={"mt-1 w-full " + CL.inp + " p-2 text-sm"} placeholder="Bearer eyJ... or PAT ..." /></div>
          <div><div className="text-xs text-zinc-400">Org GUID (optional)</div><input value={orgGuid} onChange={e => set('orgGuid', e.target.value)} className={"mt-1 w-full " + CL.inp + " px-3 py-2 text-sm"} placeholder="fe2b..." /></div>
        </div>
      </div>

      {/* Legacy/Config API Settings */}
      <div className={CL.card}>
        <div className="mb-2 font-semibold">Videon Config API</div>
        <div className="space-y-2">
          <div><div className="text-xs text-zinc-400">Base URL (<code>{'{baseUrl}/devices/{device_guid}/config'}</code>)</div><input value={base} onChange={e => set('base', e.target.value)} className={"mt-1 w-full " + CL.inp + " px-3 py-2 text-sm"} placeholder="https://your.api" /></div>
          <div><div className="text-xs text-zinc-400">Bearer (optional)</div><input value={bearer} onChange={e => set('bearer', e.target.value)} className={"mt-1 w-full " + CL.inp + " px-3 py-2 text-sm"} placeholder="eyJ..." /></div>
        </div>
      </div>

      {/* Cloudport Settings */}
      <div className={CL.card}>
        <div className="mb-2 flex items-center justify-between"><div className="font-semibold">Amagi CLOUDPORT</div><div className="flex items-center gap-2 text-xs"><span className={CL.muted}>{statusOf('cloudport')}</span><Button onClick={() => onRunTest('cloudport')} disabled={isBusy('cloudport')}>{isBusy('cloudport') ? 'Testing...' : 'Test'}</Button></div></div>
        <div className="grid gap-2 text-sm md:grid-cols-2">
          <div><div className="text-xs text-zinc-400">Release</div><select className={CL.inp + " mt-1 w-full px-2 py-2 text-sm"} value={cloudport.release || 'CP_3.31.x+'} onChange={e => setCloudport({ ...cloudport, release: e.target.value })}><option value="CP_3.31.x+">CP_3.31.x and above</option><option value="older">Older than CP_3.31.x</option></select></div>
          <div><div className="text-xs text-zinc-400">Base host / URL</div><input className={CL.inp + " mt-1 w-full px-3 py-2 text-sm"} placeholder="https://customer.example.com" value={cloudport.baseHost || ''} onChange={e => setCloudport({ ...cloudport, baseHost: e.target.value })} /></div>
          <div className="md:col-span-2"><div className="text-xs text-zinc-400">User Auth Token</div><textarea className={CL.inp + " mt-1 w-full p-2 text-sm"} rows={2} value={cloudport.userAuthToken || ''} onChange={e => setCloudport({ ...cloudport, userAuthToken: e.target.value })} placeholder="Bearer ..." /></div>
        </div>
        <div className={"mt-2 text-xs " + CL.muted}>Release determines which ingest API path is used.</div>
      </div>

      {/* Tellyo Settings */}
      <div className={CL.card}>
        <div className="mb-2 flex items-center justify-between"><div className="font-semibold">Amagi STUDIO</div><div className="flex items-center gap-2 text-xs"><span className={CL.muted}>{statusOf('tellyo')}</span><Button onClick={() => onRunTest('tellyo')} disabled={isBusy('tellyo')}>{isBusy('tellyo') ? 'Testing...' : 'Test'}</Button></div></div>
        <div className="grid gap-2 text-sm md:grid-cols-2">
          <div><div className="text-xs text-zinc-400">API endpoint</div><input className={CL.inp + " mt-1 w-full px-3 py-2 text-sm"} placeholder="https://openapi.tellyo.com/tellyo-rtc-web" value={tellyo.apiEndpoint || ''} onChange={e => setTellyo({ ...tellyo, apiEndpoint: e.target.value })} /></div>
          <div><div className="text-xs text-zinc-400">API version</div><select className={CL.inp + " mt-1 w-full px-2 py-2 text-sm"} value={tellyo.apiVersion || 'v2'} onChange={e => setTellyo({ ...tellyo, apiVersion: e.target.value })}><option value="v2">v2 (preferred)</option><option value="v1">v1 (legacy)</option></select></div>
          <div><div className="text-xs text-zinc-400">Organization ID (optional)</div><input className={CL.inp + " mt-1 w-full px-3 py-2 text-sm"} value={tellyo.organizationId || ''} onChange={e => setTellyo({ ...tellyo, organizationId: e.target.value })} placeholder="12345" /></div>
          <div className="md:col-span-2"><div className="text-xs text-zinc-400">Access Token</div><textarea className={CL.inp + " mt-1 w-full p-2 text-sm"} rows={2} value={tellyo.token || ''} onChange={e => setTellyo({ ...tellyo, token: e.target.value })} placeholder="opaque token" /></div>
        </div>
      </div>

      {/* App Preferences */}
      <div className={CL.card}>
        <div className="mb-2 font-semibold">Security & Controls</div>
        <div className="space-y-3 text-sm">
          <label className="flex items-center gap-3"><Switch checked={safeMode} onChange={v => set('safeMode', v)} /><div className="flex flex-col"><span>Safe Mode (block POST/PUT/DELETE)</span><span className={"text-xs " + CL.muted}>Disable to allow writes to Videon, CLOUDPORT, and Tellyo.</span></div></label>
          <label className="flex items-center gap-3"><Switch checked={rememberSecrets} onChange={v => set('rememberSecrets', v)} /><div className="flex flex-col"><span>Remember API tokens on this device</span><span className={"text-xs " + CL.muted}>When off, credentials remain in session storage only.</span></div></label>
          <label className="flex items-center gap-3"><Switch checked={bypassVideonError} onChange={v => set('bypassVideonError', v)} /><div className="flex flex-col"><span>Bypass Videon Error</span><span className={"text-xs " + CL.muted}>Continue configuring CLOUDPORT/STUDIO even if Videon config fails.</span></div></label>
          <div><div className="text-xs text-zinc-400">Poll Rate (ms)</div><input type="number" min="1000" className={CL.inp + " mt-1 w-full px-3 py-2 text-sm"} value={pollRate} onChange={e => set('pollRate', Math.max(1000, Number(e.target.value)))} /></div>
        </div>
      </div>

      <div className={CL.card}>
        <div className="mb-2 font-semibold">Appearance</div>
        <div className="flex items-center gap-2"><input value={accent} onChange={e => set('accent', e.target.value)} className={"w-40 " + CL.inp + " px-3 py-2 text-sm"} placeholder="#f97316" /><span className="text-xs text-zinc-400">Accent color</span></div>
      </div>
      <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-zinc-800"><Button disabled={!hasChanges} onClick={onDiscard}>Discard</Button><Button p disabled={!hasChanges} onClick={onSave}>Save Changes</Button></div>
    </div>
  );
}