import React, { useState, useEffect, useMemo } from 'react';
import { CL } from './ui/Theme';
import { Button, Drawer, Modal, ConfirmModal } from './ui/Primitive';
import { API } from '../api/videonApi';
import { ago, sleep, sanitizeLabel, parseOutputs, parseOutputMetrics } from '../utils/helpers';
import { buildTellyoChannelPayload } from '../utils/tellyoUtils';
import { defaultTellyoConfig } from '../utils/constants';

const OUTPUT_CONFIRM_DELAYS = [300, 600, 1200];

// Detail Component
// Provides a detailed view of a specific device, including its current state, active alerts, and output configuration.
// It allows users to rename the device, reboot it, or apply a full configuration profile (inputs/outputs).
export default function Detail({ open, onClose, device, jwt, orgGuid, profiles, setProfiles, onRename, safeMode, bypassVideonError, onWriteBlocked, cloudportSettings, tellyoSettings, setToast, pollRate = 5000 }) {
  // --- Local State ---
  const [state, setState] = useState(null); // Device runtime state (from API)
  const [outs, setOuts] = useState([]); // List of current outputs on the device
  const [err, setErr] = useState("");
  const [als, setAls] = useState([]); // Recent alerts for this device
  const [devName, setDevName] = useState(device?.name || device?.id);
  const [selPid, setSelPid] = useState(""); // Selected Profile ID for configuration
  const cur = profiles.find(p => p.id === selPid); // The actual profile object
  
  // Op status tracking
  const [opStatus, setOpStatus] = useState({}); // Status of individual output toggle operations
  const [op, setOp] = useState(""); // Current global operation (e.g., 'reboot', 'restart')
  
  // Manual endpoint configuration modal
  const [ipModalOpen, setIpModalOpen] = useState(false);
  const [manualIp, setManualIp] = useState("");
  const [manualPort, setManualPort] = useState("");
  
  // Status of external service configuration steps
  const [cloudStatus, setCloudStatus] = useState({ state: 'idle', message: '', label: '', id: '' });
  const [tellyoStatus, setTellyoStatus] = useState({ state: 'idle', message: '', channel: '', streamUrl: '' });
  
  // Parsed metrics for displaying bitrate/status in the UI
  const [outputMetrics, setOutputMetrics] = useState([]);

  // Configuration Progress State
  const [configSteps, setConfigSteps] = useState(null);

  const pushStep = (label) => {
    setConfigSteps(prev => {
      const list = prev ? [...prev] : [];
      if (list.length && list[list.length-1].status === 'running') list[list.length-1].status = 'done';
      list.push({ label, status: 'running' });
      return list;
    });
  };
  const failStep = (msg) => {
    setConfigSteps(prev => {
      const list = prev ? [...prev] : [];
      if (list.length) { list[list.length-1].status = 'error'; list[list.length-1].msg = msg; }
      return list;
    });
  };
  const doneSteps = () => {
    setConfigSteps(prev => {
      const list = prev ? [...prev] : [];
      if (list.length && list[list.length-1].status === 'running') list[list.length-1].status = 'done';
      return list;
    });
  };

  // Deletion confirmation state
  const [confirmData, setConfirmData] = useState(null); // { title, msg, action }

  // --- Derived State & Styles ---
  const cloudStatusTone = cloudStatus.state === 'success' ? 'text-green-400' : cloudStatus.state === 'error' ? 'text-red-400' : cloudStatus.state === 'pending' ? 'text-zinc-300' : 'text-zinc-400';
  const cloudStatusText = cloudStatus.state === 'pending' ? 'Configuring CLOUDPORT ingest...' : cloudStatus.message;
  const tellyoStatusTone = tellyoStatus.state === 'success' ? 'text-green-400' : tellyoStatus.state === 'error' ? 'text-red-400' : tellyoStatus.state === 'pending' ? 'text-zinc-300' : 'text-zinc-400';
  const tellyoStatusText = tellyoStatus.state === 'pending' ? 'Creating Tellyo channel...' : tellyoStatus.message;
  const isOnline = !!state?.online;
  const srtRunning = outputMetrics.some(metric => metric.type === 'srt' && metric.status === 'RUNNING');
  const displayStatus = isOnline ? (srtRunning ? "Running" : "Stopped") : "Offline";

  // --- Effects ---

  // Poll for device details (state, shadows, alerts) when the drawer is open
  useEffect(() => {
    if (!open || !device) { setState(null); setOuts([]); setErr(""); setAls([]); return; }
    setDevName(device.name); let alive = true;
    const load = async () => {
      try {
        const [st, sh, al] = await Promise.all([
          API.deviceState(jwt, orgGuid, device.id), API.deviceShadows(jwt, orgGuid, device.id), API.deviceAlerts(jwt, orgGuid, [device.id], { size: 5 }),
        ]);
        if (!alive) return;
        // Handle both wrapped ({ state: ... }) and unwrapped (direct object) state responses
        setState(st?.state || st || {}); 
        setErr("");
        const shadowOutputs = sh?.shadows || sh;
        setOuts(parseOutputs(shadowOutputs)); setOutputMetrics(parseOutputMetrics(shadowOutputs)); setAls(al?.alerts || []);
      } catch (e) { if (alive) setErr(String(e.message || e)); }
    };
    load(); const t = setInterval(load, pollRate); return () => { alive = false; clearInterval(t); };
  }, [open, device, jwt, orgGuid, pollRate]);

  // Restore deployment status when a profile is selected
  useEffect(() => {
    if (!cur) {
      setTellyoStatus({ state: 'idle', message: '' });
      setCloudStatus({ state: 'idle', message: '' });
      return;
    }
    if (cur.tellyo?.lastChannelId) {
      setTellyoStatus({ state: 'success', message: 'Previously deployed', channel: cur.tellyo.channelName, streamUrl: cur.tellyo.lastStreamUrl });
    } else {
      setTellyoStatus({ state: 'idle', message: '' });
    }
    if (cur.cloudport?.lastIngestId) {
      setCloudStatus({ state: 'success', message: 'Previously deployed', label: cur.cloudport.ingestLabel, id: cur.cloudport.lastIngestId });
    } else {
      setCloudStatus({ state: 'idle', message: '' });
    }
  }, [selPid]);

  // Poll Cloudport status if deployed
  useEffect(() => {
    if (!open || !cur?.cloudport?.lastIngestId || !cloudportSettings?.baseHost) return;
    let alive = true;
    const pollCp = async () => {
      try {
        const label = cur.cloudport.ingestLabel;
        if (!label) return;
        const { ingest } = await API.cloudportFetchByLabel(cloudportSettings, label);
        if (!alive || !ingest) return;
        
        const remoteState = !!(ingest.always_on || ingest.ingest_flows?.[0]?.always_on);
        setProfiles(prev => {
          const p = prev.find(x => x.id === cur.id);
          if (p && !!p.cloudport?.alwaysOn === remoteState) return prev;
          return prev.map(x => x.id === cur.id ? { ...x, cloudport: { ...x.cloudport, alwaysOn: remoteState } } : x);
        });
      } catch (e) { /* ignore poll errors */ }
    };
    const t = setInterval(pollCp, pollRate); return () => { alive = false; clearInterval(t); };
  }, [open, cur?.cloudport?.lastIngestId, cur?.cloudport?.ingestLabel, cloudportSettings, pollRate, cur?.id]);

  // --- Actions ---

  // Generic command executor (reboot, etc.)
  const doCmd = async (label, payload) => {
    if (safeMode) { onWriteBlocked?.(); return; }
    setOp(label); setErr("");
    const effectiveOrgGuid = (label === 'reboot' || label === 'restart') ? null : orgGuid;
    try { await API.postCommand(jwt, effectiveOrgGuid, device.id, payload); setOp(label + '-ok'); setToast(`${label} command sent`); } catch (e) { setOp(label + '-err'); setErr(`Command failed: ${String(e.message || e)}`); } finally { setTimeout(() => setOp(""), 2000); }
  };

  // Restarts the encoding pipeline (stop all -> start all)
  const handleRestart = async () => {
    if (safeMode) { onWriteBlocked?.(); return; }
    setOp('restart'); setErr('');
    
    try {
      // 1. Fetch current shadow to find enabled outputs and version
      const shRes = await API.deviceShadows(jwt, orgGuid, device.id);
      const shadows = shRes?.shadows || shRes; // handle wrapped or unwrapped
      const outputsShadow = Array.isArray(shadows) ? shadows.find(s => s.shadow_name === 'Outputs') : shadows;

      if (!outputsShadow) throw new Error("Could not retrieve Outputs shadow");

      const version = outputsShadow.current_version ?? outputsShadow.version ?? 0;
      const reportedState = outputsShadow.reported?.state;
      
      let targets = [];
      
      if (Array.isArray(reportedState)) {
          targets = reportedState.filter(o => o.config?.enable === true);
      } else {
          if (typeof reportedState === 'object') {
             // Fallback: try to convert object to array if needed, or just throw if unexpected.
             targets = Object.values(reportedState).filter(o => o.config?.enable === true);
          }
      }

      if (!targets.length) {
          setOp('restart-ok'); 
          setToast('No active outputs to restart.');
          setTimeout(() => setOp(""), 2000);
          return;
      }

      // 2. Construct Payload to STOP (enable: false)
      const stopState = targets.map(t => ({
          id: t.id || t.output_id, // Ensure we have the ID
          type: t.type,
          config: { enable: false }
      }));

      const stopPayload = {
          command_type: "set",
          commands: [{
              shadow_name: "Outputs",
              state: stopState,
              target_version: version
          }]
      };

      // Send STOP
      await API.updateShadow(jwt, orgGuid, device.id, stopPayload);
      
      // 3. Wait
      await sleep(2000);

      // 4. Construct Payload to START (enable: true)
      // We reuse the list but flip the bit.
      // Note: target_version might need incrementing if the device is strict, 
      // but usually for a subsequent command we might need to fetch version again or just use current+1.
      // Safest is to fetch version again or just hope it accepts the new state. 
      // The "set" command usually handles version checking.
      // Let's fetch shadow again to get new version to be safe, or just increment.
      
      const shRes2 = await API.deviceShadows(jwt, orgGuid, device.id);
      const shadows2 = shRes2?.shadows || shRes2;
      const outputsShadow2 = Array.isArray(shadows2) ? shadows2.find(s => s.shadow_name === 'Outputs') : shadows2;
      const version2 = outputsShadow2?.current_version ?? outputsShadow2?.version ?? (version + 1);

      const startState = targets.map(t => ({
          id: t.id || t.output_id,
          type: t.type,
          config: { enable: true }
      }));

      const startPayload = {
          command_type: "set",
          commands: [{
              shadow_name: "Outputs",
              state: startState,
              target_version: version2
          }]
      };

      // Send START
      await API.updateShadow(jwt, orgGuid, device.id, startPayload);

      setOp('restart-ok'); setToast('Restart sequence completed');
    } catch (e) { setOp('restart-err'); setErr(`Restart failed: ${String(e.message || e)}`); } finally { setTimeout(() => setOp(""), 2000); }
  };

  const doRename = async () => {
    if (safeMode) { onWriteBlocked?.(); return; }
    const n = (devName || "").trim(); if (!n) return;
    try { await API.renameDevice(jwt, orgGuid, device.id, n); onRename?.(device.id, n); setToast("Device renamed"); } catch (e) { setErr(String(e.message || e)); }
  };

  // Main Configuration Logic:
  // 1. Checks and configures Tellyo Channel (if enabled in profile).
  // 2. Checks Cloudport status (placeholder).
  // 3. Configures Videon device encoders and outputs based on the profile.
  const handleConfigure = async () => {
    if (!cur) return; setIpModalOpen(false);
    if (safeMode) { onWriteBlocked?.(); return; }
    setConfigSteps([{ label: "Initializing configuration...", status: "running" }]);
    
    // Reset status and show initial toast
    setErr(''); setToast('Configuring endpoints...');
    setCloudStatus({ state: 'pending', message: 'Waiting for Videon...' }); 
    setTellyoStatus({ state: 'pending', message: 'Waiting for Videon...' });

    let videonSuccess = false;
    const newOutputs = JSON.parse(JSON.stringify(cur.outputs || [])); // Deep copy to modify
    const deviceIp = state?.external_ip || device.ip || device.localIp;

    // Pre-assign ports for Tellyo/Cloudport outputs so they are available even if Videon config fails (and bypass is on).
    let portCounter = 10001;
    newOutputs.forEach((output) => {
      if (output.target === 'Tellyo Studio' || output.target === 'Amagi CLOUDPORT') {
        const port = portCounter++;
        if (port > 10100) throw new Error("Port range exhausted (10001-10100)");
        output._tempPort = port;
      }
    });
    // Reset counter for the actual loop inside try block to ensure matching IDs
    portCounter = 10001;

    // --- Step 1: Videon Device Configuration (Split Workflow) ---
    // 1. Create Encoders -> 2. Wait -> 3. Get IDs -> 4. Create Outputs

    try {
      console.log("[Config] Starting configuration sequence...");
      setToast('Step 1/4: Fetching device state...');
      pushStep("Fetching device state...");
      // 1. Fresh GET on device shadow state
      const shRes = await API.deviceShadows(jwt, orgGuid, device.id);
      const shadows = shRes?.shadows || (Array.isArray(shRes) ? shRes : []);
      
      const getShadow = (name) => shadows.find(x => x.shadow_name === name);
      
      const getItems = (name) => {
        const s = getShadow(name);
        const state = s?.reported?.state;
        if (Array.isArray(state)) return state;
        if (state && typeof state === 'object') return Object.values(state);
        return [];
      };
      const inputId = getItems('Inputs')?.[0]?.id;
      const encVersion = getShadow('Encoders')?.current_version ?? getShadow('Encoders')?.version ?? 0;

      const videoName = `${cur.name || "Profile"}_video`; const audioName = `${cur.name || "Profile"}_audio`;
      const videoEnc = { ...(cur.encoder?.video || {}) };
      const audioEnc = { ...(cur.encoder?.audio || {}) };
      if (typeof audioEnc.channels === 'string') { const chMap = { mono: 1, stereo: 2, '5.1': 6 }; audioEnc.channels = chMap[audioEnc.channels.toLowerCase()] || 2; }
      
      // Prepare Encoders State (Merge/Update)
      const currentEncoders = getItems('Encoders');
      
      // Capture existing IDs to identify new ones later
      const preVideoIds = new Set(currentEncoders.filter(e => (e.type === 'video' || e.config?.type === 'video')).map(e => e.id));
      const preAudioIds = new Set(currentEncoders.filter(e => (e.type === 'audio' || e.config?.type === 'audio')).map(e => e.id));

      // Filter out existing encoders with the same name to "replace" them
      const nextEncoders = currentEncoders.filter(e => {
        const n = e.config?.name || e.name;
        return n !== videoName && n !== audioName;
      });

      // Add new Video Encoder
      nextEncoders.push({
        type: "video",
        config: {
          name: videoName,
          active: true,
          in_channel_id: inputId,
          selected_codec: (videoEnc.codec === "hevc" ? "H265" : "H264"),
          bitrate: (videoEnc.bitrate_kbps || 5000),
          bitrate_mode: videoEnc.mode === "CBR" ? "constant" : "variable",
          scaling_resolution: `RES_${videoEnc.width || 1920}X${videoEnc.height || 1080}`,
          keyframe_interval: videoEnc.keyint || (videoEnc.keyunit === "seconds" ? 2 : 60),
          keyframe_unit: videoEnc.keyunit === "seconds" ? "SECONDS" : "FRAMES",
          latency_mode: videoEnc.qa === "Quality priority" ? "NORMAL" : "LOW",
          limit_to_30_fps: false,
          klv_timestamp_enabled: !!videoEnc.klv,
          cc_processing_enabled: !!videoEnc.captions,
          allow_outputs_to_adjust_bitrate: false,
          h264_profile: "PROFILE_HIGH",
          h265_profile: "PROFILE_MAIN"
        }
      });

      // Add new Audio Encoder
      const sampleRateMap = { 48000: "SAMPLE_48_khz", 44100: "SAMPLE_44p1_khz", 32000: "SAMPLE_32_khz" };
      const sampleVal = sampleRateMap[audioEnc.sample_rate] || "SAMPLE_48_khz";
      const channels = audioEnc.channels === 6 ? [1,2,3,4,5,6] : audioEnc.channels === 1 ? [1] : [1,2];

      nextEncoders.push({
        type: "audio",
        config: {
          name: audioName,
          active: true,
          in_channel_id: inputId,
          codec: (audioEnc.codec === "aac" ? "mpeg4_aac" : audioEnc.codec || "mpeg4_aac"),
          bitrate: (audioEnc.bitrate_kbps || 128),
          sample: sampleVal,
          mix_mode: audioEnc.channels === 6 ? "SURROUND_5_1" : audioEnc.channels === 1 ? "MONO" : "STEREO",
          bitrate_mode: "variable",
          selected_channels: channels
        }
      });

      // 2. SET Encoders
      console.log("[Config] Sending encoder configuration...");
      setToast('Step 2/4: Configuring encoders...');
      pushStep("Configuring encoders...");
      await API.setDeviceShadows(jwt, orgGuid, device.id, [
        { shadow_name: "Encoders", target_version: encVersion, state: nextEncoders }
      ]);

      // Pause to allow profile creation
      console.log("[Config] Waiting for encoders to initialize...");
      setToast('Step 2/4: Waiting for encoders...');
      pushStep("Waiting for encoders to initialize (20s)...");
      await sleep(20000); // Increased wait time

      // 3. GET Shadow to get Encoder IDs
      console.log("[Config] Verifying encoder creation...");
      setToast('Step 3/4: Verifying encoders...');
      pushStep("Verifying encoder creation...");
      const shRes2 = await API.deviceShadows(jwt, orgGuid, device.id);
      const shadows2 = shRes2?.shadows || (Array.isArray(shRes2) ? shRes2 : []);
      const outVersion = (shadows2.find(x => x.shadow_name === 'Outputs')?.current_version) ?? (shadows2.find(x => x.shadow_name === 'Outputs')?.version) ?? 0;
      
      const findId2 = (sName, iName) => {
          const s = shadows2.find(x => x.shadow_name === sName);
          const list = s?.reported?.state ? (Array.isArray(s.reported.state) ? s.reported.state : Object.values(s.reported.state)) : [];
          return list.find(i => i.config?.name === iName || i.name === iName)?.id;
      };

      let vidId = findId2('Encoders', videoName);
      let audId = findId2('Encoders', audioName);

      // Fallback: Check for new IDs if name lookup failed
      if (!vidId || !audId) {
          const s = shadows2.find(x => x.shadow_name === 'Encoders');
          const list = s?.reported?.state ? (Array.isArray(s.reported.state) ? s.reported.state : Object.values(s.reported.state)) : [];
          
          if (!vidId) {
              const newVid = list.find(e => (e.type === 'video' || e.config?.type === 'video') && !preVideoIds.has(e.id));
              if (newVid) vidId = newVid.id;
          }
          if (!audId) {
              const newAud = list.find(e => (e.type === 'audio' || e.config?.type === 'audio') && !preAudioIds.has(e.id));
              if (newAud) audId = newAud.id;
          }
      }

      if (!vidId) {
        console.error("Could not find video encoder:", videoName, "in shadows:", shadows2);
        throw new Error(`Video encoder '' not found after creation.`);
      }
      if (!audId) {
        console.error("Could not find audio encoder:", audioName, "in shadows:", shadows2);
        throw new Error(`Audio encoder '' not found after creation.`);
      }

// Prepare Outputs State
      const currentOutputs = (shadows2.find(x => x.shadow_name === 'Outputs')?.reported?.state) || [];
      // Use 'let' instead of 'const' so we can remap it
      let nextOutputs = Array.isArray(currentOutputs) ? [...currentOutputs] : Object.values(currentOutputs);

      const portMap = {}; // Maps port -> output index in newOutputs

      newOutputs.forEach((output, index) => {
          // Remove existing output if we have a tracked ID
          if (output.videonId) {
             const idx = nextOutputs.findIndex(o => (o.out_stream_id || o.id) === output.videonId);
             if (idx !== -1) nextOutputs.splice(idx, 1);
          }

          const commonCaps = [
            "ES_VIDEO_H264", "ES_VIDEO_H265", "ES_AUDIO_AAC_MPEG4_ADTS",
            "DATA_SMPTE291_10BIT_SCTE_104", "DATA_SMPTE2038",
            "DATA_MPEGTS_METADATA_AU_WRAPPER_KLV_SYNC"
          ];

          if (output.target === 'Tellyo Studio' || output.target === 'Amagi CLOUDPORT') {
              // Auto-assign port for Listener
              const port = output._tempPort; // Use pre-assigned port
              portCounter++; // Increment local counter to keep sync if needed, though we use _tempPort
              
              portMap[port] = index;

              nextOutputs.push({
                id: false,
                type: "srt",
                config: {
                    enable: true,
                    destination_ip: "",
                    destination_port: port,
                    latency: 120,
                    passphrase: "",
                    bw_overhead: 25,
                    key_size: "AES128",
                    sources: {
                        audio: [audId],
                        video: [vidId],
                        data: []
                    },
                    stream_id: "",
                    call_mode: "LISTENER",
                    encryption_enabled: false,
                    name: output.name || `${output.target} ${index +1}`
                },
                data_sources: { data_source_ids: [] }
              });
          } else if (manualIp && manualPort) {
              if (output.target !== 'Tellyo Studio') {
                  nextOutputs.push({
                    id: false,
                    type: "srt",
                    config: {
                        enable: true,
                        destination_ip: manualIp,
                        destination_port: +manualPort + index,
                        latency: 120,
                        passphrase: "",
                        bw_overhead: 25,
                        key_size: "AES128",
                        sources: {
                            audio: [audId],
                            video: [vidId],
                            data: []
                        },
                        stream_id: "",
                        call_mode: "CALLER",
                        encryption_enabled: false,
                        name: output.name || `Manual Output ${index + 1}`
                    },
                    data_sources: { data_source_ids: [] }
                  });
              }
          }
      });

      // 4. SET Outputs
      console.log("[Config] Sending output configuration...");
      setToast('Step 4/4: Configuring outputs...');
      pushStep("Configuring outputs...");
      await API.setDeviceShadows(jwt, orgGuid, device.id, [
        { shadow_name: "Outputs", target_version: outVersion, state: nextOutputs }
      ]);

      // Poll shadow to capture new IDs
      console.log("[Config] Finalizing...");
      setToast('Step 4/4: Finalizing...');
      pushStep("Finalizing Videon configuration...");
      await sleep(2000); 
      // 5. GET Shadow (Confirm)
      const finalShRes = await API.deviceShadows(jwt, orgGuid, device.id);
      const finalShadows = finalShRes?.shadows || (Array.isArray(finalShRes) ? finalShRes : []);
      const reported = (Array.isArray(finalShadows) ? finalShadows.find(s => s.shadow_name === 'Outputs') : finalShadows)?.reported?.state || [];
      
      // Map reported outputs back to our profile outputs using the port
      if (Array.isArray(reported)) {
          reported.forEach(ro => {
              const roPort = ro.output_type?.srt?.dest_port || ro.config?.destination_port;
              const roType = ro.output_type?.value || ro.type;
              
              if (roType === 'srt' && roPort) {
                  const p = roPort;
                  if (portMap[p] !== undefined) {
                      newOutputs[portMap[p]].videonId = ro.out_stream_id || ro.id;
                  }
              }
          });
      }

      // Update profile with new IDs immediately
      setProfiles(prev => prev.map(p => p.id === cur.id ? { ...p, outputs: newOutputs } : p));
      videonSuccess = true;

      console.log("[Config] Videon configuration successful.");
    } catch (e) { 
        console.error("[Config] Failed:", e);
        if (bypassVideonError) {
          setErr(`Videon config failed (Bypassed): ${e.message || String(e)}`);
        } else {
          setErr(`Videon config failed: ${e.message || String(e)}`); 
          failStep(e.message || String(e));
          setCloudStatus({ state: 'idle', message: '' });
          setTellyoStatus({ state: 'idle', message: '' });
          return;
        }
    }
    
    if (videonSuccess) setToast('Videon configured. Setting up remotes...');

    // --- Step 2: External Configuration (Tellyo/Cloudport) ---
    // Now that Videon is listening, we configure the remotes to call in.
    pushStep("Configuring external services...");

    // Tellyo Configuration
    const tellyoOuts = newOutputs.filter(o => o.target === 'Tellyo Studio');
    if (tellyoOuts.length > 0 && tellyoOuts[0]._tempPort) {
        const out = tellyoOuts[0];
        try {
            if (!tellyoSettings?.apiEndpoint || !tellyoSettings?.token) throw new Error("Tellyo settings missing");
            
            const streamUrl = `srt://${deviceIp}:${out._tempPort}`;
            const telConfig = { ...defaultTellyoConfig(), ...(cur.tellyo || {}), streamUrl };
            const channelName = telConfig.channelName || sanitizeLabel(cur.name, 'lec_channel');
            
            setTellyoStatus({ state: 'pending', message: `Configuring ...` });

            const channels = await API.tellyoListChannels(tellyoSettings);
            let channel = cur.tellyo?.lastChannelId ? channels.find(c => c.id === cur.tellyo.lastChannelId) : null;
            if (!channel) channel = channels.find(c => c.name === channelName);

            const payload = buildTellyoChannelPayload(cur, { ...telConfig, channelName, streamUrl }, deviceIp, channels, channel?.id);
            
            if (channel) {
                await API.tellyoUpdateChannel(tellyoSettings, channel.id, payload);
                setTellyoStatus({ state: 'success', message: `Channel updated`, streamUrl });
            } else {
                const res = await API.tellyoCreateChannel(tellyoSettings, payload);
                channel = res.channel;
                setTellyoStatus({ state: 'success', message: `Channel created`, streamUrl });
            }
            
            if (channel?.id) {
                setProfiles(prev => prev.map(p => p.id === cur.id ? { ...p, tellyo: { ...p.tellyo, lastChannelId: channel.id, lastStreamUrl: streamUrl } } : p));
            }
        } catch (e) { setTellyoStatus({ state: 'error', message: String(e.message || e) }); }
    } else { setTellyoStatus({ state: 'idle', message: '' }); }

    // Cloudport Configuration
    const cpOuts = newOutputs.filter(o => o.target === 'Amagi CLOUDPORT');
    if (cpOuts.length > 0 && cpOuts[0]._tempPort) {
        const out = cpOuts[0];
        try {
            if (!cloudportSettings?.baseHost || !cloudportSettings?.userAuthToken) throw new Error("Cloudport settings missing");
            
            const streamUrl = `srt://${deviceIp}:${out._tempPort}`;
            const cpConfig = { ...(cur.cloudport || {}) };
            const ingestLabel = cpConfig.ingestLabel || sanitizeLabel(cur.name, 'lec_ingest');
            
            setCloudStatus({ state: 'pending', message: `Configuring ...` });

            const tracks = [];
            if (cur.encoder?.video) {
                const v = cur.encoder.video;
                tracks.push({ type: "video", tag: "Studio", codec: v.codec || "h264", resolution: `${v.height || 1080}p${v.fps || 60}`, frame_rate: String(v.fps || 60), pid: 256 });
            }
            if (cur.encoder?.audio) {
                const a = cur.encoder.audio;
                tracks.push({ type: "audio", tag: "eng", codec: a.codec || "aac", enable_live_captioning: true, pid: 257 });
            }
            if (cpConfig.includeData) {
                tracks.push({ type: "data", tag: "data1", codec: cpConfig.dataCodec || "scte", pid: 500 });
            }

            let accountDomain = '';
            try {
                const u = new URL(cloudportSettings.baseHost.startsWith('http') ? cloudportSettings.baseHost : `https://${cloudportSettings.baseHost}`);
                accountDomain = u.hostname.split('.')[0];
            } catch (e) {}

            const payload = {
                ingest_label: ingestLabel,
                account_domain: accountDomain,
                ingest_flows: [{
                    name: "primary",
                    compute_profile: cpConfig.computeProfile || "medium",
                    stream_url: streamUrl,
                    protocol: cpConfig.protocol || "udp",
                    stream_mode: cpConfig.streamMode || "ts",
                    source_head_start: Number(cpConfig.headStart) || 11.9,
                    source_elic_delay: Number(cpConfig.elicDelay) || 6.8,
                    pcr_pid: 256,
                    enable_stream_parsing: !!cpConfig.enableStreamParsing,
                    record: !!cpConfig.record,
                    always_on: !!cpConfig.alwaysOn,
                    enable_low_res: !!cpConfig.includeLowRes,
                    tracks: tracks
                }]
            };

            await sleep(1000);
            const { ingest } = await API.cloudportFetchByLabel(cloudportSettings, ingestLabel);
            
            if (ingest) {
                const ingestId = ingest.id || ingest.ingest_id;
                await API.cloudportUpdate(cloudportSettings, ingestId, payload);
                setCloudStatus({ state: 'success', message: `Ingest updated`, label: ingestLabel, id: ingestId });
                setProfiles(prev => prev.map(p => p.id === cur.id ? { ...p, cloudport: { ...p.cloudport, lastIngestId: ingestId, lastStreamUrl: streamUrl } } : p));
            } else {
                const res = await API.cloudportCreate(cloudportSettings, payload);
                const newId = res?.id || (Array.isArray(res?.ingests) ? res.ingests[0]?.id : null);
                setCloudStatus({ state: 'success', message: `Ingest created`, label: ingestLabel, id: newId });
                if (newId) setProfiles(prev => prev.map(p => p.id === cur.id ? { ...p, cloudport: { ...p.cloudport, lastIngestId: newId, lastStreamUrl: streamUrl } } : p));
            }
        } catch (e) { setCloudStatus({ state: 'error', message: String(e.message || e) }); }
    } else { setCloudStatus({ state: 'idle', message: '' }); }
    doneSteps();
  };

  const markOutputs = (ids, status) => { const u = {}; for (const id of ids) u[id] = status; setOpStatus(s => ({ ...s, ...u })); };
  
  // Confirms that a requested output state change has actually been applied by the device
  // by polling the shadow state until it matches or times out.
  const confirmOutputsState = async (check) => {
    for (const delay of OUTPUT_CONFIRM_DELAYS) { await sleep(delay); const sh = await API.deviceShadows(jwt, orgGuid, device.id); const outs = parseOutputs(sh?.shadows || sh); if (check(outs)) return { ok: true, outs }; }
    const finalSh = await API.deviceShadows(jwt, orgGuid, device.id); const finalOuts = parseOutputs(finalSh?.shadows || finalSh); return { ok: check(finalOuts), outs: finalOuts };
  };

  // Toggle a single output on/off
  const toggleOut = async it => {
    if (safeMode) { onWriteBlocked?.(); return; }
    const id = it.matchId; if (!id) return; markOutputs([id], "busy");
    try {
      await API.postOutputs(jwt, orgGuid, device.id, [{ output_id: id, enable: !it.enabled }]);
      const res = await confirmOutputsState(list => { const o = list.find(x => x.output_id === id); return !!o && o.enabled === !it.enabled; });
      if (res.ok) setOuts(res.outs); markOutputs([id], res.ok ? "ok" : "err");
      if (res.ok) setErr(""); else setErr(prev => prev || `Output  did not confirm.`);
    } catch (e) { markOutputs([id], "err"); setErr(String(e.message || e)); } finally { setTimeout(() => markOutputs([id], null), 1500); }
  };

  const deleteTellyoChannel = async () => {
    if (!cur || !cur.tellyo?.lastChannelId) return;
    if (safeMode) { onWriteBlocked?.(); return; }
    
    const channelId = cur.tellyo.lastChannelId;
    const channelName = cur.tellyo.channelName || "Channel";

    setConfirmData({
      title: "Delete Tellyo Channel",
      msg: `Are you sure you want to delete Tellyo channel ""? This will permanently remove it from Tellyo Studio.`,
      action: async () => {
        setTellyoStatus({ state: 'pending', message: `Deleting channel ...` });
        try {
            await API.tellyoDeleteChannel(tellyoSettings, channelId);
            setProfiles(prev => prev.map(p => p.id === cur.id ? { ...p, tellyo: { ...p.tellyo, lastChannelId: null, lastStreamUrl: null } } : p));
            setTellyoStatus({ state: 'idle', message: 'Channel deleted' });
        } catch (e) {
            setTellyoStatus({ state: 'error', message: String(e.message || e) });
        }
      }
    });
  };

  const toggleCloudport = async () => {
    if (!cur || !cur.cloudport?.lastIngestId) return;
    if (safeMode) { onWriteBlocked?.(); return; }
    
    const cpConfig = cur.cloudport;
    const nextState = !cpConfig.alwaysOn;
    const label = nextState ? "Enabling" : "Disabling";
    
    setCloudStatus({ state: 'pending', message: ` CLOUDPORT feed...` });

    try {
        let accountDomain = '';
        try {
            const u = new URL(cloudportSettings.baseHost.startsWith('http') ? cloudportSettings.baseHost : `https://${cloudportSettings.baseHost}`);
            accountDomain = u.hostname.split('.')[0];
        } catch (e) {}

        const tracks = [];
        if (cur.encoder?.video) {
            const v = cur.encoder.video;
            tracks.push({ type: "video", tag: "Studio", codec: v.codec || "h264", resolution: `${v.height || 1080}p${v.fps || 60}`, frame_rate: String(v.fps || 60), pid: 256 });
        }
        if (cur.encoder?.audio) {
            const a = cur.encoder.audio;
            tracks.push({ type: "audio", tag: "eng", codec: a.codec || "aac", enable_live_captioning: true, pid: 257 });
        }
        if (cpConfig.includeData) {
            tracks.push({ type: "data", tag: "data1", codec: cpConfig.dataCodec || "scte", pid: 500 });
        }

        const payload = {
            ingest_label: cpConfig.ingestLabel || sanitizeLabel(cur.name, 'lec_ingest'),
            account_domain: accountDomain,
            ingest_flows: [{
                name: "primary",
                compute_profile: cpConfig.computeProfile || "medium",
                stream_url: cpConfig.lastStreamUrl || cpConfig.streamUrl,
                protocol: cpConfig.protocol || "udp",
                stream_mode: cpConfig.streamMode || "ts",
                source_head_start: Number(cpConfig.headStart) || 11.9,
                source_elic_delay: Number(cpConfig.elicDelay) || 6.8,
                pcr_pid: 256,
                enable_stream_parsing: !!cpConfig.enableStreamParsing,
                record: !!cpConfig.record,
                always_on: nextState,
                enable_low_res: !!cpConfig.includeLowRes,
                tracks: tracks
            }]
        };

        await API.cloudportUpdate(cloudportSettings, cpConfig.lastIngestId, payload);
        
        setProfiles(prev => prev.map(p => p.id === cur.id ? { ...p, cloudport: { ...p.cloudport, alwaysOn: nextState } } : p));
        setCloudStatus({ state: 'success', message: `Feed ${nextState ? 'enabled' : 'disabled'}`, label: cpConfig.ingestLabel, id: cpConfig.lastIngestId });
    } catch (e) {
        setCloudStatus({ state: 'error', message: String(e.message || e) });
    }
  };

  const deleteCloudportIngest = async () => {
    if (!cur) return;
    if (safeMode) { onWriteBlocked?.(); return; }
    
    const label = cur.cloudport?.ingestLabel || sanitizeLabel(cur.name, 'lec_ingest');

    setConfirmData({
      title: "Delete CLOUDPORT Feed",
      msg: `Are you sure you want to delete CLOUDPORT ingest ""? This will stop the stream and remove the configuration from Amagi CLOUDPORT.`,
      action: async () => {
        setCloudStatus({ state: 'pending', message: `Deleting ingest ...` });
        try {
            // Step 1: GET info to ensure we have the correct ID and it exists
            const { ingest } = await API.cloudportFetchByLabel(cloudportSettings, label);
            const ingestId = ingest?.id || ingest?.ingest_id || cur.cloudport?.lastIngestId;
            if (!ingestId) throw new Error("Ingest point not found.");

            // Step 2: DELETE command
            await API.cloudportDelete(cloudportSettings, ingestId);
            
            setProfiles(prev => prev.map(p => p.id === cur.id ? { ...p, cloudport: { ...p.cloudport, lastIngestId: null, alwaysOn: false } } : p));
            setCloudStatus({ state: 'idle', message: 'Ingest deleted' });
        } catch (e) {
            setCloudStatus({ state: 'error', message: String(e.message || e) });
        }
      }
    });
  };

  // Maps the current profile outputs to the actual device outputs by name matching
  const mapped = useMemo(() => {
    if (!cur) return [];
    return (cur.outputs || []).map(p => { const match = outs.find(o => o.name === p.name); return { ...p, matchId: match?.output_id, enabled: match?.enabled }; });
  }, [cur, outs]);

  return (
    <Drawer open={open} onClose={onClose}>
      <div className="border-b border-zinc-800 p-3">
        <div className="flex items-center gap-2">
          <div className="font-semibold">Details -</div>
          <input className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm" value={devName} onChange={e => setDevName(e.target.value)} placeholder="Device name" style={{ minWidth: 140 }} />
          <Button onClick={doRename} disabled={!jwt || safeMode || (devName || "").trim() === (device?.name || device?.id)}>Save Name</Button>
          <span className="text-xs px-2 py-1 rounded-full border border-zinc-700 bg-zinc-900">{displayStatus}</span>
          <div className="ml-auto flex gap-2">
            <Button onClick={() => doCmd("reboot", { command: "reboot_device" })} disabled={!jwt || safeMode || op.startsWith('reboot')}>{op === 'reboot' ? 'Rebooting...' : op === 'reboot-ok' ? 'Reboot ✓' : op === 'reboot-err' ? 'Reboot ✕' : 'Reboot'}</Button>
          </div>
        </div>
      </div>
      <div className="space-y-3 p-3">
        {err && <div className="text-sm text-red-400">Error: {err}</div>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className={CL.card}>
            <div className="mb-2 font-semibold">State</div>
            <div className="grid grid-cols-[120px_1fr] gap-1 text-sm text-zinc-300">
              <div className="text-zinc-500">GUID</div><div>{device?.id}</div><div className="text-zinc-500">Online</div><div>{isOnline ? "Yes" : "No"}</div>
              <div className="text-zinc-500">Last update</div><div>{state?.last_state_update ? ago(state.last_state_update) : "-"}</div>
            </div>
          </div>
          <div className={CL.card}>
            <div className="mb-2 font-semibold">Recent alerts</div>
            {als.length ? <div className="space-y-2">{als.map(a => (<div key={a.alert_guid} className="flex items-center justify-between text-sm"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${a.silenced ? "bg-zinc-500" : "bg-red-500"}`} /><span className="font-medium">{a.name || a.label || a.alert_type}</span><span className={CL.muted}>{ago(a.timestamp)}</span>{a.silenced && <span className="text-xs px-2 py-1 rounded-full border border-zinc-700 bg-zinc-900">silenced</span>}</div></div>))}</div> : <div className={"text-sm " + CL.muted}>No alerts.</div>}
          </div>
        </div>
        <div className={CL.card}>
          <div className="mb-2 font-semibold">Output Metrics</div>
          <table className="w-full text-sm"><thead><tr className={CL.muted}><th className="py-1 text-left">Type</th><th className="py-1 text-left">Destination IP</th><th className="py-1 text-left">Port</th><th className="py-1 text-left">Status</th></tr></thead><tbody>{outputMetrics.map((it, i) => (<tr key={i} className="border-b border-zinc-800 last:border-0"><td className="py-1">{it.type || "-"}</td><td className="py-1">{it.destination_ip || "-"}</td><td className="py-1">{it.destination_port || "-"}</td><td className="py-1">{it.status || "-"}</td></tr>))}</tbody></table>
        </div>
        {configSteps && (
          <div className={CL.card + " animate-in fade-in slide-in-from-top-4 duration-500"}>
            <div className="mb-2 flex items-center justify-between">
              <div className="font-semibold">Configuration Progress</div>
              <Button onClick={() => setConfigSteps(null)}>Close</Button>
            </div>
            <div className="space-y-2 text-sm font-mono max-h-60 overflow-y-auto">
              {configSteps.map((s, i) => (
                <div key={i} className={`flex items-center gap-2 ${s.status === 'done' ? 'text-green-400' : s.status === 'error' ? 'text-red-400' : 'text-zinc-100'}`}>
                  <span>{s.status === 'done' ? '✓' : s.status === 'error' ? '✕' : '→'}</span>
                  <span>{s.label}</span>
                  {s.status === 'error' && <span className="text-xs text-zinc-500">({s.msg})</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className={CL.card}>
          <div className="mb-2 flex items-center justify-between"><div className="font-semibold">Configured Outputs</div><div className="flex items-center gap-2"><select className={CL.inp + " px-2 py-1 text-sm"} value={selPid} onChange={e => setSelPid(e.target.value)}><option value="">Select profile...</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><Button onClick={() => handleConfigure(true)} disabled={!cur || safeMode}>Configure endpoints</Button></div></div>
          {!mapped.length ? <div className={"text-sm " + CL.muted}>No outputs to show. Select a profile and click "Configure endpoints".</div> : <table className="w-full text-sm"><thead><tr className={CL.muted}><th className="py-1 text-left">Name</th><th className="py-1 text-left">Target</th><th className="py-1 text-left">Linked</th><th className="py-1 text-left">Status</th></tr></thead><tbody>{mapped.map((it, i) => { 
            let linkedContent = it.matchId ? "Yes" : <span className="text-zinc-400">No (name must match device)</span>;
            let statusDot = <span className="h-2 w-2 rounded-full bg-zinc-600 inline-block" />;

            if (it.target === 'Amagi CLOUDPORT' && cloudStatus.state !== 'idle') {
              linkedContent = <div className={`text-xs `}><div>{cloudStatusText || (cloudStatus.state === 'success' ? 'Ingest updated' : cloudStatus.state === 'pending' ? 'Configuring...' : '')}</div>{cloudStatus.label && <div className="text-[10px] text-zinc-500">{cloudStatus.label}</div>}</div>;
              linkedContent = <div className={`text-xs ${cloudStatusTone}`}><div>{cloudStatusText || (cloudStatus.state === 'success' ? 'Ingest updated' : cloudStatus.state === 'pending' ? 'Configuring...' : '')}</div>{cloudStatus.label && <div className="text-[10px] text-zinc-500">{cloudStatus.label}</div>}</div>;
            } else if (it.target === 'Tellyo Studio' && tellyoStatus.state !== 'idle') {
              linkedContent = <div className={`text-xs `}><div>{tellyoStatusText || (tellyoStatus.state === 'success' ? 'Channel ready' : tellyoStatus.state === 'pending' ? 'Creating...' : '')}</div>{tellyoStatus.channel && <div className="text-[10px] text-zinc-500">{tellyoStatus.channel}</div>}</div>;
              linkedContent = <div className={`text-xs ${tellyoStatusTone}`}><div>{tellyoStatusText || (tellyoStatus.state === 'success' ? 'Channel ready' : tellyoStatus.state === 'pending' ? 'Creating...' : '')}</div>{tellyoStatus.channel && <div className="text-[10px] text-zinc-500">{tellyoStatus.channel}</div>}</div>;
            }
            
            if (it.target === 'Amagi CLOUDPORT') {
              const isDeployed = !!cur?.cloudport?.lastIngestId;
              const isOn = !!cur?.cloudport?.alwaysOn;
              statusDot = isDeployed ? (isOn ? <span className="h-2 w-2 rounded-full bg-green-500 inline-block" title="Always On" /> : <span className="h-2 w-2 rounded-full bg-red-500 inline-block" title="Stopped" />) : <span className="h-2 w-2 rounded-full bg-red-500 inline-block" title="Not Deployed" />;
            } else if (it.target === 'Tellyo Studio') {
              const exists = !!cur?.tellyo?.lastChannelId;
              statusDot = exists ? <span className="h-2 w-2 rounded-full bg-green-500 inline-block" title="Channel Exists" /> : <span className="h-2 w-2 rounded-full bg-red-500 inline-block" title="Channel Not Created" />;
            } else if (it.matchId) {
              statusDot = it.enabled ? <span className="h-2 w-2 rounded-full bg-green-500 inline-block" title="Enabled" /> : <span className="h-2 w-2 rounded-full bg-red-500 inline-block" title="Disabled" />;
            }

            return (<tr key={i} className="border-b border-zinc-800 last:border-0"><td className="py-1">{it.name || "-"}</td><td className="py-1">{it.target}</td><td className="py-1">{linkedContent}</td><td className="py-1">{statusDot}</td></tr>); 
          })}</tbody></table>}
          <div className="mt-2 flex gap-2"><Button onClick={deleteTellyoChannel} disabled={!jwt || safeMode || !cur?.tellyo?.lastChannelId}>Delete Tellyo Channel</Button><Button onClick={deleteCloudportIngest} disabled={!jwt || safeMode || !cur?.cloudport?.lastIngestId}>Delete CLOUDPORT Feed</Button><Button onClick={toggleCloudport} disabled={!jwt || safeMode || !cur?.cloudport?.lastIngestId}>{cur?.cloudport?.alwaysOn ? "Disable CLOUDPORT Feed" : "Enable CLOUDPORT Feed"}</Button></div>
        </div>
      </div>
      <Modal open={ipModalOpen} onClose={() => setIpModalOpen(false)}>
        <div className="space-y-3">
          <div className="font-semibold">Manual Endpoint Configuration</div><p className="text-sm text-zinc-400">Enter the destination IP and port for the output. This will be used to create an SRT output on the device.</p>
          <div><div className="text-xs text-zinc-400">Destination IP</div><input value={manualIp} onChange={e => setManualIp(e.target.value)} className={"mt-1 w-full " + CL.inp + " px-3 py-2 text-sm"} placeholder="e.g., 52.16.239.71" /></div>
          <div><div className="text-xs text-zinc-400">Destination Port</div><input type="number" value={manualPort} onChange={e => setManualPort(e.target.value)} className={"mt-1 w-full " + CL.inp + " px-3 py-2 text-sm"} placeholder="e.g., 10006" /></div>
          <div className="flex justify-end gap-2 border-t border-zinc-800 pt-3 mt-3"><Button onClick={() => setIpModalOpen(false)}>Cancel</Button><Button p onClick={handleConfigure}>GO</Button></div>
        </div>
      </Modal>
      <ConfirmModal open={!!confirmData} onClose={() => setConfirmData(null)} onConfirm={() => { confirmData?.action(); setConfirmData(null); }} title={confirmData?.title} ominous>
        {confirmData?.msg}
      </ConfirmModal>
      <div className="border-t border-zinc-800 p-3 flex justify-end"><Button onClick={onClose}>Close</Button></div>
    </Drawer>
  );
}
