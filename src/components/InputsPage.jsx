import React, { useState } from 'react';
import { CL } from './ui/Theme';
import { Button, ConfirmModal } from './ui/Primitive';
import { uid, sanitizeLabel } from '../utils/helpers';
import { 
  VIDEO_CODECS, AUDIO_CODECS, RESOS, ENC_MODES, KF_UNITS, QA_LAT, OUTPUT_TARGETS,
  CLOUDPORT_COMPUTE, CLOUDPORT_PROTOCOLS, CLOUDPORT_STREAM_MODES,
  defaultCloudportConfig, defaultTellyoConfig 
} from '../utils/constants';

// --- Helper Components ---

// Simple radio group for selecting audio channels (Mono/Stereo/5.1)
function ChannelsPicker({ value = "stereo", onChange }) {
  const opts = [
    { v: "mono", label: "Mono (1.0)" },
    { v: "stereo", label: "Stereo (2.0)" },
    { v: "5.1", label: "5.1 Surround" },
  ];
  return (
    <div className="flex gap-2">
      {opts.map(o => (
        <label key={o.v} className="inline-flex items-center gap-2 text-sm">
          <input type="radio" name="chsel" checked={value === o.v} onChange={() => onChange(o.v)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

// Editor form for a single profile.
// Handles deep updates to the profile object using the 'set' helper.
function InputsEditor({ value, onChange }) {
  const v = value || {};

  // Utility to update nested properties (e.g., "encoder.video.bitrate") safely.
  const set = (path, val) => {
    const next = { ...(v || {}) };
    let t = next;
    const parts = path.split(".");
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      t[k] = t[k] ?? {};
      t = t[k];
    }
    t[parts[parts.length - 1]] = val;
    onChange(next);
  };

  const cp = { ...defaultCloudportConfig(), ...(v.cloudport || {}) };
  const tel = { ...defaultTellyoConfig(), ...(v.tellyo || {}) };
  const outputs = Array.isArray(v.outputs) ? v.outputs : [];

  // Manage the list of desired outputs (e.g., Tellyo, Cloudport, Generic SRT)
  const addOutput = () => onChange({ ...v, outputs: [...outputs, { target: OUTPUT_TARGETS[0], name: "" }] });
  const delOutput = i => onChange({ ...v, outputs: outputs.filter((_, idx) => idx !== i) });
  const updOutput = (i, key, val) =>
    onChange({ ...v, outputs: outputs.map((o, idx) => (idx === i ? { ...o, [key]: val } : o)) });

  const baseName = v.name || "Profile";
  const vName = `${baseName}_video`;
  const aName = `${baseName}_audio`;

  // Determine selected resolution label based on width, height, and optionally FPS
  const vid = v.encoder?.video || {};
  const selRes = RESOS.find(r => r.w === vid.width && r.h === vid.height && (!r.fps || r.fps === vid.fps));

  const handleNameChange = (e) => {
    const val = e.target.value;
    const sanitized = val ? sanitizeLabel(val) : "";
    
    const nextOutputs = outputs.map((o, i) => i === 0 ? { ...o, name: val } : o);

    onChange({
      ...v,
      name: val,
      cloudport: { ...cp, ingestLabel: sanitized },
      tellyo: { ...tel, channelName: sanitized },
      outputs: nextOutputs
    });
  };

  return (
    <div className="space-y-3">
      {/* General Profile Settings */}
      <div className={CL.card}>
        <div className="mb-2 font-semibold">Profile</div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="col-span-2">
            <div className="text-xs text-zinc-400">Config name</div>
            <input className={CL.inp + " px-2 py-1 w-full"} value={v.name || ""} onChange={handleNameChange} placeholder="My Live Profile" />
          </div>
          <div><div className="text-xs text-zinc-400">Encoder name (video)</div><input className={CL.inp + " px-2 py-1 w-full"} value={vName} readOnly /></div>
          <div><div className="text-xs text-zinc-400">Encoder name (audio)</div><input className={CL.inp + " px-2 py-1 w-full"} value={aName} readOnly /></div>
        </div>
      </div>

      {/* Video Encoder Settings */}
      <div className={CL.card}>
        <div className="mb-2 font-semibold">Video</div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <div className="text-xs text-zinc-400">Codec</div>
            <select className={CL.inp + " px-2 py-1 w-full"} value={v.encoder?.video?.codec || ""} onChange={e => set("encoder.video.codec", e.target.value)}>
              <option value="">Select...</option>{VIDEO_CODECS.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs text-zinc-400">Resolution</div>
            <select className={CL.inp + " px-2 py-1 w-full"} value={selRes?.label || ""}
              onChange={e => { 
                const r = RESOS.find(x => x.label === e.target.value);
                if (r) {
                  const next = { ...v };
                  next.encoder = { ...(next.encoder || {}) };
                  next.encoder.video = { ...(next.encoder.video || {}), width: r.w, height: r.h };
                  if (r.fps) next.encoder.video.fps = r.fps;
                  
                  next.tellyo = { ...(next.tellyo || {}), profile: r.label };
                  
                  onChange(next);
                }
              }}>
              <option value="">Select...</option>
              {RESOS.map(r => <option key={r.label} value={r.label}>{r.label}</option>)}
            </select>
          </div>
          <div><div className="text-xs text-zinc-400">FPS</div><input type="number" className={CL.inp + " px-2 py-1 w-full"} value={v.encoder?.video?.fps ?? ""} onChange={e => set("encoder.video.fps", e.target.valueAsNumber || 0)} /></div>
          <div>
            <div className="text-xs text-zinc-400">Encoding mode</div>
            <select className={CL.inp + " px-2 py-1 w-full"} value={v.encoder?.video?.mode || ENC_MODES[0]} onChange={e => set("encoder.video.mode", e.target.value)}>
              {ENC_MODES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div><div className="text-xs text-zinc-400">Video bitrate (kbps)</div><input type="number" className={CL.inp + " px-2 py-1 w-full"} value={v.encoder?.video?.bitrate_kbps ?? ""} onChange={e => set("encoder.video.bitrate_kbps", e.target.valueAsNumber || 0)} /></div>
          <div><div className="text-xs text-zinc-400">Keyframe interval</div><input type="number" className={CL.inp + " px-2 py-1 w-full"} value={v.encoder?.video?.keyint ?? ""} onChange={e => set("encoder.video.keyint", e.target.valueAsNumber || 0)} /></div>
          <div>
            <div className="text-xs text-zinc-400">Keyframe unit</div>
            <select className={CL.inp + " px-2 py-1 w-full"} value={v.encoder?.video?.keyunit || KF_UNITS[0]} onChange={e => set("encoder.video.keyunit", e.target.value)}>
              {KF_UNITS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <div className="text-xs text-zinc-400">Quality & latency</div>
            <select className={CL.inp + " px-2 py-1 w-full"} value={v.encoder?.video?.qa || QA_LAT[0]} onChange={e => set("encoder.video.qa", e.target.value)}>
              {QA_LAT.map(q => <option key={q} value={q}>{q}</option>)}
            </select>
          </div>
          <label className="col-span-2 inline-flex items-center gap-2"><input type="checkbox" checked={!!v.encoder?.video?.klv} onChange={e => set("encoder.video.klv", e.target.checked)} /><span>Enable KLV timecode</span></label>
          <label className="col-span-2 inline-flex items-center gap-2"><input type="checkbox" checked={!!v.encoder?.video?.captions} onChange={e => set("encoder.video.captions", e.target.checked)} /><span>Enable processing for captions</span></label>
        </div>
      </div>

      {/* Audio Encoder Settings */}
      <div className={CL.card}>
        <div className="mb-2 font-semibold">Audio</div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <div className="text-xs text-zinc-400">Codec</div>
            <select className={CL.inp + " px-2 py-1 w-full"} value={v.encoder?.audio?.codec || ""} onChange={e => set("encoder.audio.codec", e.target.value)}>
              <option value="">Select...</option>{AUDIO_CODECS.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
          </div>
          <div><div className="text-xs text-zinc-400">Bitrate (kbps)</div><input type="number" className={CL.inp + " px-2 py-1 w-full"} value={v.encoder?.audio?.bitrate_kbps ?? ""} onChange={e => set("encoder.audio.bitrate_kbps", e.target.valueAsNumber || 0)} /></div>
          <div className="col-span-2"><div className="text-xs text-zinc-400">Channels</div><ChannelsPicker value={v.encoder?.audio?.channels || "stereo"} onChange={val => set("encoder.audio.channels", val)} /></div>
          <div className="col-span-2"><div className="text-xs text-zinc-400">Sample rate</div><input type="number" className={CL.inp + " px-2 py-1 w-full"} value={v.encoder?.audio?.sample_rate ?? 48000} onChange={e => set("encoder.audio.sample_rate", e.target.valueAsNumber || 48000)} /></div>
        </div>
      </div>

      {/* Output Targets */}
      <div className={CL.card}>
        <div className="mb-2 flex items-center justify-between"><div className="font-semibold">Configured Outputs</div><Button onClick={addOutput}>Add</Button></div>
        {!outputs.length && <div className={"text-sm " + CL.muted}>None defined.</div>}
        {outputs.map((o, i) => (
          <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_auto] items-center gap-2">
            <select className={CL.inp + " px-2 py-1"} value={o.target || OUTPUT_TARGETS[0]} onChange={e => updOutput(i, "target", e.target.value)}>{OUTPUT_TARGETS.map(t => <option key={t} value={t}>{t}</option>)}</select>
            <input className={CL.inp + " px-2 py-1"} placeholder="Output name" value={o.name || ""} onChange={e => updOutput(i, "name", e.target.value)} />
            <Button onClick={() => delOutput(i)}>Remove</Button>
          </div>
        ))}
      </div>

      {/* Cloudport Specific Settings */}
      <div className={CL.card}>
        <div className="mb-2 font-semibold">CLOUDPORT Ingest</div>
        <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <div><div className="text-xs text-zinc-400">Compute profile</div><select className={CL.inp + " mt-1 w-full px-2 py-2"} value={cp.computeProfile} onChange={e => set('cloudport.computeProfile', e.target.value)}>{CLOUDPORT_COMPUTE.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><div className="text-xs text-zinc-400">Protocol</div><select className={CL.inp + " mt-1 w-full px-2 py-2"} value={cp.protocol} onChange={e => set('cloudport.protocol', e.target.value)}>{CLOUDPORT_PROTOCOLS.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}</select></div>
          <div><div className="text-xs text-zinc-400">Stream mode</div><select className={CL.inp + " mt-1 w-full px-2 py-2"} value={cp.streamMode} onChange={e => set('cloudport.streamMode', e.target.value)}>{CLOUDPORT_STREAM_MODES.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}</select></div>
          <div><div className="text-xs text-zinc-400">Head start</div><input type="number" step="0.1" className={CL.inp + " mt-1 w-full px-2 py-1"} value={cp.headStart ?? ''} onChange={e => set('cloudport.headStart', e.target.value === '' ? '' : Number(e.target.value))} /></div>
          <div><div className="text-xs text-zinc-400">ELIC delay</div><input type="number" step="0.1" className={CL.inp + " mt-1 w-full px-2 py-1"} value={cp.elicDelay ?? ''} onChange={e => set('cloudport.elicDelay', e.target.value === '' ? '' : Number(e.target.value))} /></div>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!cp.enableStreamParsing} onChange={e => set('cloudport.enableStreamParsing', e.target.checked)} /><span>Enable stream parsing</span></label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!cp.record} onChange={e => set('cloudport.record', e.target.checked)} /><span>Record</span></label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!cp.alwaysOn} onChange={e => set('cloudport.alwaysOn', e.target.checked)} /><span>Always on</span></label>
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!cp.includeLowRes} onChange={e => set('cloudport.includeLowRes', e.target.checked)} /><span>Enable low-res output</span></label>
          <label className="inline-flex items-center gap-2 col-span-1 md:col-span-2"><input type="checkbox" checked={!!cp.includeData} onChange={e => set('cloudport.includeData', e.target.checked)} /><span>Include SCTE data track</span></label>
        </div>
        {cp.includeData && (
          <div className="mt-2 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
            <div><div className="text-xs text-zinc-400">Data codec</div><input className={CL.inp + " mt-1 w-full px-2 py-1"} value={cp.dataCodec} onChange={e => set('cloudport.dataCodec', e.target.value)} placeholder="scte" /></div>
            <div><div className="text-xs text-zinc-400">Data mode</div><input className={CL.inp + " mt-1 w-full px-2 py-1"} value={cp.dataMode} onChange={e => set('cloudport.dataMode', e.target.value)} placeholder="splice_insert" /></div>
          </div>
        )}
        <div className={"mt-2 text-xs " + CL.muted}>Tracks are derived from the profile's video and audio settings. Provide a unique ingest label and stream URL per tenant.</div>
      </div>

      {/* Tellyo Specific Settings */}
      <div className={CL.card}>
        <div className="mb-2 font-semibold">Tellyo Channel</div>
        <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <div><div className="text-xs text-zinc-400">Chunk length (seconds)</div><input type="number" min={1} className={CL.inp + " mt-1 w-full px-2 py-1"} value={tel.chunkLength ?? ''} onChange={e => set('tellyo.chunkLength', e.target.value === '' ? '' : Number(e.target.value))} /></div>
          <div><div className="text-xs text-zinc-400">24h start time (optional, epoch)</div><input className={CL.inp + " mt-1 w-full px-2 py-1"} value={tel.twentyFourStartTime ?? ''} onChange={e => set('tellyo.twentyFourStartTime', e.target.value)} placeholder="" /></div>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!tel.startDataCollection} onChange={e => set('tellyo.startDataCollection', e.target.checked)} /><span>Start data collection with recording</span></label>
        </div>
        <div className={"mt-2 text-xs " + CL.muted}>Used when creating or reusing Tellyo channels. Leave blank fields to use sensible defaults.</div>
      </div>
    </div>
  );
}

// --- Main Component ---
export default function InputsPage({ rows, profiles, setProfiles }) {
  const [selId, setSelId] = useState(profiles[0]?.id || "");
  const cur = profiles.find(c => c.id === selId);
  const [delId, setDelId] = useState(null);

  // Profile Management Actions
  const create = () => {
    const id = uid();
    const item = {
      id, name: "New Profile",
      encoder: { video: { codec: "h264", width: 1920, height: 1080, fps: 60, mode: "CBR", bitrate_kbps: 5000, keyint: 120, keyunit: "frames", qa: "Latency priority", klv: false, captions: false },
                 audio: { codec: "aac", bitrate_kbps: 128, channels: "stereo", sample_rate: 48000 } },
      outputs: [{ target: "Tellyo Studio", name: "primary" }],
      cloudport: defaultCloudportConfig(),
      tellyo: defaultTellyoConfig(),
    };
    setProfiles(prev => [item, ...prev]);
    setSelId(id);
  };

  const rename = () => { const n = prompt("Profile name:", cur?.name || ""); if (n && cur) setProfiles(prev => prev.map(c => (c.id === cur.id ? { ...c, name: n } : c))); };
  const duplicate = () => { if (!cur) return; const id = uid(); const copy = JSON.parse(JSON.stringify(cur)); copy.id = id; copy.name = cur.name + " (copy)"; setProfiles(prev => [copy, ...prev]); setSelId(id); };
  
  const remove = () => { if (!cur) return; setDelId(cur.id); };
  const confirmRemove = () => {
    if (delId) {
      setProfiles(prev => prev.filter(c => c.id !== delId));
      setSelId(p => (p === delId ? "" : p));
    }
    setDelId(null);
  };
  
  // Updates the currently selected profile with new data from the editor
  const update = next => { if (!cur) return; setProfiles(prev => prev.map(c => (c.id === cur.id ? { ...c, ...next } : c))); };

  return (
    <div className="space-y-3">
      {/* Action Bar */}
      <div className="flex items-center gap-2">
        <Button onClick={create}>New</Button><Button onClick={duplicate} disabled={!cur}>Duplicate</Button><Button onClick={rename} disabled={!cur}>Rename</Button><Button onClick={remove} disabled={!cur}>Delete</Button>
        <div className="ml-auto flex items-center gap-2"><span className={CL.muted}>Selected profile:</span><select className={CL.inp + " px-2 py-1 text-sm"} value={selId} onChange={e => setSelId(e.target.value)}>{profiles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}{!profiles.length && <option value="">-</option>}</select></div>
      </div>
      {/* Editor Area */}
      <div className={CL.card}>{cur ? <InputsEditor value={cur} onChange={v => update(v)} /> : <div className={"text-sm " + CL.muted}>No profile selected.</div>}</div>
      <ConfirmModal open={!!delId} onClose={() => setDelId(null)} onConfirm={confirmRemove} title="Delete Profile" ominous>
        Are you sure you want to delete the profile <strong className="text-white">{profiles.find(p => p.id === delId)?.name}</strong>? This action cannot be undone.
      </ConfirmModal>
    </div>
  );
}