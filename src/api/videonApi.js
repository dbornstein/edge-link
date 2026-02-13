// src/api/videonApi.js
// This file acts as the central API abstraction layer for the application.
// It handles communication with:
// 1. Videon Cloud API (Device management, state, commands)
// 2. Amagi CLOUDPORT API (Ingest management)
// 3. Tellyo API (Channel and organization management)
//
// It also includes logic for handling authentication, proxying requests in local development (to avoid CORS),
// and providing fallback/mock data when no API keys are present.

import { auth, nextTok } from '../utils/helpers';
import { demoDevices, demoOutputsShadow, demoAllAlerts } from './mockData';
import { tellyoChannelEndpoint } from '../utils/tellyoUtils';

// Determine if we are running in a local environment to enable the proxy.
// The proxy is needed to bypass CORS restrictions when calling external APIs from the browser.
const shouldProxy = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);

// --- Fetch Wrappers ---

// `vx` is a specialized fetch wrapper for the Videon Cloud API.
// It automatically handles JWT authentication, org_guid injection, and JSON parsing.
// If an error occurs, it throws a descriptive error message.
async function vx(url, { jwt, orgGuid, method = "GET", headers = {}, body } = {}) {
  const h = { ...headers };
  // Add the Authorization header if a JWT is provided.
  if (jwt) h.Authorization = auth(jwt);

  let targetUrl = url;
  // If an Organization GUID is provided, append it to the query parameters.
  // This is required for multi-tenant Videon accounts.
  if (orgGuid) {
    const u = new URL(url);
    u.searchParams.append("org_guid", orgGuid);
    targetUrl = u.toString();
  }

  const r = await fetch(targetUrl, { method, headers: h, body });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`${r.status} ${txt || r.statusText}`);
  }
  // Safely parse JSON responses only if the content-type matches.
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) return r.json();
  return {};
}

// `externalRequest` is a generic fetch wrapper for third-party APIs (Cloudport, Tellyo).
// It handles the decision to route through the local proxy or go direct.
export async function externalRequest(url, { method = 'GET', headers = {}, body, expectJson = true } = {}) {
  const payload = body === undefined ? undefined : body;
  
  console.log(`[API] ${method} ${url}`, payload);

  const doFetch = () => {
    // If running locally, route the request through the Vite dev server proxy (`/__proxy__`).
    // This avoids CORS errors that would otherwise block direct calls to Tellyo/Cloudport.
    if (shouldProxy) {
      return fetch('/__proxy__', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The real request details are sent in the body of the proxy request.
        body: JSON.stringify({ url, method, headers, body: payload }),
      });
    }
    // In production (or non-local), attempt a direct fetch.
    return fetch(url, { method, headers, body: payload });
  };

  const res = await doFetch();
  const contentType = res.headers.get('content-type') || '';
  const textBody = await res.text().catch(() => '');

  console.log(`[API] Response ${res.status} from ${url}:`, textBody.slice(0, 500));

  // Error handling: try to parse JSON error responses for better messages.
  if (!res.ok) {
    if (contentType.includes('application/json')) {
      try {
        const data = JSON.parse(textBody || '{}');
        throw new Error(data?.error || data?.message || `${res.status} ${res.statusText}`);
      } catch {
        throw new Error(textBody || `${res.status} ${res.statusText}`);
      }
    }
    throw new Error(textBody || `${res.status} ${res.statusText}`);
  }

  if (!expectJson) return textBody;

  // Success handling: parse JSON if expected and available.
  if (contentType.includes('application/json')) {
    if (!textBody) return {};
    return JSON.parse(textBody);
  }
  // Fallback: try to parse if it looks like JSON even if header is missing
  if (textBody && (textBody.trim().startsWith('{') || textBody.trim().startsWith('['))) {
    try { return JSON.parse(textBody); } catch {}
  }
  if (!textBody) return {};
  throw new Error('Unexpected response from external request');
}

// --- Cloudport Helpers ---

// Constructs the base URL for Cloudport API calls based on the version/release.
// Older releases use a different path structure (`/v1/api` vs `/epub/v1/api`).
const cloudportBaseInfo = (settings = {}) => {
  const host = (settings.baseHost || '').trim();
  if (!host) throw new Error('CloudPORT base host is missing.');
  const normalized = host.startsWith('http') ? host : `https://${host}`;
  const base = normalized.replace(/\/$/, '');
  // Determine the correct API path prefix based on the selected release version.
  const path = (settings.release === 'older') ? '/v1/api/ingests' : '/epub/v1/api/ingests';
  return { base, path };
};

// Generates the standard headers for Cloudport, including the Bearer token.
const cloudportHeaders = (settings = {}) => {
  const token = (settings.userAuthToken || '').trim();
  if (!token) throw new Error('CloudPORT auth token is missing.');
  const auth = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  return {
    Authorization: auth,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
};

// Helper to build the full Cloudport URL.
const cloudportUrl = (settings, suffix = '') => {
  const { base, path } = cloudportBaseInfo(settings);
  return `${base}${path}${suffix}`;
};

// Normalizes the response from Cloudport, as different versions might wrap the list in `ingests`, `items`, or return it directly.
const extractCloudportIngests = (data) => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.ingests)) return data.ingests;
    if (Array.isArray(data?.items)) return data.items;
    return [];
}

// --- Tellyo Helpers ---

// Helper to convert organization IDs to numbers if they are purely numeric strings.
const toNumericOrg = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  }
  return null;
};

// Parses and validates Tellyo settings to construct API base URLs and authentication info.
// Handles versioning (v1 vs v2) and organization ID resolution.
const tellyoBaseInfo = (settings = {}) => {
  const endpoint = (settings.apiEndpoint || settings.base || '').trim();
  if (!endpoint) throw new Error('Tellyo API endpoint is missing.');
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('Tellyo endpoint must be a valid URL.');
  }
  
  // Logic to determine the API root from the provided endpoint URL.
  // It looks for patterns like `/rest/open/v1` or `/rest/open/v2` to strip them and find the base.
  const segments = parsed.pathname.split('/').filter(Boolean);
  let idxOpen = -1;
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i].toLowerCase() === 'open' && i + 1 < segments.length) {
      const next = segments[i + 1].toLowerCase();
      if (next === 'v1' || next === 'v2') { idxOpen = i; break; }
    }
  }
  const hasRest = idxOpen > 0 && segments[idxOpen - 1].toLowerCase() === 'rest';
  const prefixSegments = idxOpen >= 0 ? segments.slice(0, hasRest ? idxOpen - 1 : idxOpen) : segments;
  const cleanJoin = (...parts) => parts
    .filter(Boolean)
    .map((part, idx) => {
      if (idx === 0) return part.replace(/\/+$/, '');
      return part.replace(/^\/+/, '').replace(/\/+$/, '');
    })
    .join('/');
  
  const baseRoot = prefixSegments.length ? cleanJoin(parsed.origin, prefixSegments.join('/')) : parsed.origin.replace(/\/+$/, '');
  const version = (settings.apiVersion || settings.version || 'v2').toLowerCase();
  const baseV1 = cleanJoin(baseRoot, 'rest', 'open', 'v1');
  const baseV2 = cleanJoin(baseRoot, 'rest', 'open', 'v2');
  const base = version === 'v1' ? baseV1 : baseV2;
  
  const orgRaw = settings.organizationId ?? settings.orgId ?? '';
  const orgTrim = typeof orgRaw === 'number' ? String(orgRaw) : String(orgRaw || '').trim();
  const orgId = orgTrim || null;
  const orgIdNumeric = toNumericOrg(orgTrim);
  const token = (settings.token || settings.tellyoToken || '').trim();
  if (!token) throw new Error('Tellyo token is missing.');
  
  return { base, version, orgId, orgIdNumeric, token, baseV1, baseV2 };
};

const tellyoHeaders = info => ({
  'Tellyo-Token': info.token,
  'Content-Type': 'application/json',
});

// Cache for resolved Tellyo Organization IDs to reduce API calls.
const tellyoOrgIdCache = new Map();

// Tellyo often requires a numeric Organization ID, but users might provide a name/slug.
// This function attempts to resolve the numeric ID by querying the API if needed.
const resolveTellyoOrgId = async (info) => {
  if (typeof info.orgIdNumeric === 'number') return info.orgIdNumeric;
  if (!info.orgId) return null;
  
  const cacheKey = `${info.token}::${info.baseV2}::${info.orgId}`;
  if (tellyoOrgIdCache.has(cacheKey)) return tellyoOrgIdCache.get(cacheKey);
  
  const normalized = value => String(value || '').trim().toLowerCase();
  const target = normalized(info.orgId);
  
  const consider = entry => {
    if (!entry) return null;
    const idCandidates = [entry.id, entry.organizationId, entry.organization_id];
    for (const candidate of idCandidates) {
      const numeric = toNumericOrg(candidate);
      if (numeric != null) return numeric;
    }
    return null;
  };

  // Try V1 API first
  try {
    const headers = { 'Tellyo-Token': info.token, 'Content-Type': 'application/json' };
    const numericHint = toNumericOrg(info.orgId);
    const effectiveId = numericHint ?? info.orgId;
    const body = effectiveId != null ? { organizationId: effectiveId } : undefined;
    const data = await externalRequest(`${info.baseV1}/organization/get`, {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const entry = data?.organization || (Array.isArray(data?.organizations) ? data.organizations[0] : data);
    const numeric = consider(entry);
    if (numeric != null) { tellyoOrgIdCache.set(cacheKey, numeric); return numeric; }
  } catch {}

  // Fallback to V2 API
  try {
    const headers = { 'Tellyo-Token': info.token };
    const data = await externalRequest(`${info.baseV2}/organizations`, { headers });
    const list = Array.isArray(data?.organizations) ? data.organizations : Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    for (const entry of list) {
      const idStrings = [entry.id, entry.organizationId, entry.organization_id].map(normalized);
      const names = [entry.name, entry.organizationName, entry.organization_name, entry.slug, entry.organizationSlug, entry.organization_slug].map(normalized);
      if (idStrings.includes(target) || names.includes(target)) {
        const numeric = consider(entry);
        if (numeric != null) { tellyoOrgIdCache.set(cacheKey, numeric); return numeric; }
      }
    }
  } catch {}
  
  tellyoOrgIdCache.set(cacheKey, null);
  return null;
};

// --- Main API Object ---

export const API = {
  // Lists all devices for the account. Returns mock data if no JWT is present.
  listDevices: (jwt, orgGuid) =>
    jwt
      ? vx("https://api.videoncloud.com/v1/devices", { jwt, orgGuid })
      : { devices: demoDevices() },

  // Fetches the realtime state of a device (uptime, encoder status, etc.)
  deviceState: (jwt, orgGuid, id) =>
    jwt
      ? vx(`https://api.videoncloud.com/v1/devices/${encodeURIComponent(id)}/state`, { jwt, orgGuid })
      : { state: { online: true, last_state_update: new Date().toISOString(), video: { bitrate_kbps: 4600, fps: 60 } } },

  // Fetches the 'Outputs' shadow to see current configuration and status.
  deviceShadows: (jwt, orgGuid, id) =>
    vx(`https://api.videoncloud.com/v1/devices/${encodeURIComponent(id)}/shadows`, { jwt, orgGuid })
      .catch(() => ({ shadows: demoOutputsShadow() })),

  // Sets device shadows directly (bulk update).
  setDeviceShadows: (jwt, orgGuid, id, commands) => {
    const payload = { command_type: "set", commands };
    console.log("[API] setDeviceShadows Request:", JSON.stringify(payload, null, 2));
    return vx(`https://api.videoncloud.com/v1/devices/${encodeURIComponent(id)}/shadows/commands`, {
      jwt, orgGuid, method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  // Updates device shadows directly (for complex state changes).
  updateShadow: (jwt, orgGuid, id, payload) =>
    vx(`https://api.videoncloud.com/v1/devices/${encodeURIComponent(id)}/shadows/commands`, {
      jwt, orgGuid, method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  // Updates output configuration (enabling/disabling, changing settings).
  postOutputs: (jwt, orgGuid, id, ops) =>
    vx(`https://api.videoncloud.com/v1/devices/${encodeURIComponent(id)}/outputs`, {
      jwt, orgGuid, method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ops),
    }),

  // Sends a command to the device (e.g., reboot, start/stop encoders).
  postCommand: (jwt, orgGuid, id, p) =>
    vx(`https://api.videoncloud.com/v1/devices/${encodeURIComponent(id)}/commands`, {
      jwt, orgGuid, method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    }),

  // Fetches alerts for specific devices.
  deviceAlerts: (jwt, orgGuid, ids, { silenced = true, size = 20, token } = {}) => {
    if (!jwt) return { alerts: demoAllAlerts(ids) };
    const u = new URL("https://api.videoncloud.com/v1/device_alerts");
    (ids || []).forEach(x => x && u.searchParams.append("device_guids", x));
    u.searchParams.set("silenced", String(silenced));
    u.searchParams.set("pagination_size", String(size));
    if (token) u.searchParams.set("pagination_token", token);
    return vx(u.toString(), { jwt, orgGuid });
  },

  // Updates an alert status (e.g., to silence it).
  patchAlert: (jwt, orgGuid, id, aid, silenced) => {
    const u = new URL(`https://api.videoncloud.com/v1/device_alerts/${encodeURIComponent(id)}`);
    u.searchParams.set("alert_guid", aid);
    return vx(u.toString(), {
      jwt, orgGuid, method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ silenced }),
    });
  },

  // Deletes/Closes an alert.
  closeAlert: (jwt, orgGuid, id, aid) => {
    const u = new URL(`https://api.videoncloud.com/v1/device_alerts/${encodeURIComponent(id)}`);
    u.searchParams.set("alert_guid", aid);
    return vx(u.toString(), { jwt, orgGuid, method: "DELETE" });
  },

  // Renames a device. Handles fallback for older device versions.
  renameDevice: async (jwt, orgGuid, id, displayName) => {
    try {
      return await vx(`https://api.videoncloud.com/v1/devices/${encodeURIComponent(id)}`, {
        jwt, orgGuid, method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName }),
      });
    } catch (e) {
      // Fallback for older tenants/devices
      return vx(`https://api.videoncloud.com/v1/devices/${encodeURIComponent(id)}`, {
        jwt, orgGuid, method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: displayName }),
      });
    }
  },

  // --- Cloudport Methods ---

  // Fetches a specific ingest by label.
  cloudportFetchByLabel: async (settings, label) => {
    const qs = label ? `?ingest_label=${encodeURIComponent(label)}` : '';
    const headers = cloudportHeaders(settings);
    // GET requests do not have a body, so Content-Type is not needed and may cause issues.
    delete headers['Content-Type'];
    
    const data = await externalRequest(cloudportUrl(settings, qs), { headers });
    const ingests = extractCloudportIngests(data);
    
    let match = null;
    if (ingests && ingests.length > 0) {
      if (label) {
        const lower = label.toLowerCase();
        match = ingests.find(x => (x.ingest_label || x.ingestLabel || x.label) === label);
        if (!match) match = ingests.find(x => (x.ingest_label || x.ingestLabel || x.label || '').toLowerCase() === lower);
        if (!match) match = ingests[0];
      } else {
        match = ingests[0];
      }
    }
    console.log(`[Cloudport] Label lookup for '${label}':`, { found: ingests.length, match: match ? (match.id || match.ingest_id) : 'null' });
    return { data, ingests, ingest: match };
  },

  cloudportCreate: async (settings, payload) => {
    return externalRequest(cloudportUrl(settings), {
      method: 'POST',
      headers: cloudportHeaders(settings),
      body: JSON.stringify(payload),
    });
  },

  cloudportUpdate: async (settings, ingestId, payload) => {
    if (ingestId === undefined || ingestId === null) throw new Error('Missing ingest id');
    return externalRequest(cloudportUrl(settings, `/${ingestId}`), {
      method: 'PUT',
      headers: cloudportHeaders(settings),
      body: JSON.stringify(payload),
    });
  },

  cloudportDelete: async (settings, ingestId) => {
    if (ingestId === undefined || ingestId === null) throw new Error('Missing ingest id');
    const headers = cloudportHeaders(settings);
    delete headers['Content-Type'];
    return externalRequest(cloudportUrl(settings, `/${ingestId}`), {
      method: 'DELETE',
      headers,
    });
  },

  // --- Tellyo Methods ---

  tellyoListChannels: async (settings = {}) => {
    const info = tellyoBaseInfo(settings);
    if (!info.orgId) throw new Error('Set the Tellyo organization ID in Settings.');
    
    // Resolve the numeric ID first if possible
    let orgNumeric = typeof info.orgIdNumeric === 'number' ? info.orgIdNumeric : toNumericOrg(info.orgId);
    if (orgNumeric == null) orgNumeric = await resolveTellyoOrgId(info);
    const effectiveId = orgNumeric ?? info.orgId;

    // Try V2 listing first if appropriate
    if (info.version !== 'v1' && orgNumeric != null) {
      try {
        const data = await externalRequest(`${info.baseV2}/organizations/${orgNumeric}/channels`, {
          method: 'GET',
          headers: { 'Tellyo-Token': info.token },
        });
        const channels = Array.isArray(data?.channels) ? data.channels : Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
        if (channels.length) return channels;
      } catch (err) {
        // Ignore 404/405/method not found, fall back to V1
        const msg = String(err?.message || err || '').toLowerCase();
        if (!msg.includes('method not found') && !msg.includes('404') && !msg.includes('405')) throw err;
      }
    }

    // V1 Fallback
    const headersV1 = { 'Tellyo-Token': info.token, 'Content-Type': 'application/json' };
    const body = effectiveId != null ? JSON.stringify({ organizationId: effectiveId }) : undefined;
    const data = await externalRequest(`${info.baseV1}/channel/get`, {
      method: 'POST',
      headers: headersV1,
      body,
    });
    if (Array.isArray(data?.channels)) return data.channels;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data)) return data;
    return data && data.channels ? data.channels : [];
  },

  tellyoCreateChannel: async (settings, payload) => {
    const info = tellyoBaseInfo(settings);
    let orgNumeric = typeof info.orgIdNumeric === 'number' ? info.orgIdNumeric : toNumericOrg(info.orgId);
    if (orgNumeric == null) orgNumeric = await resolveTellyoOrgId(info);
    const effectiveInfo = { ...info, orgIdNumeric: orgNumeric };
    
    const headers = tellyoHeaders(effectiveInfo);
    // Use the utility to determine the correct V1 vs V2 endpoint
    const { url, method } = tellyoChannelEndpoint(effectiveInfo);
    
    const effectiveId = orgNumeric ?? effectiveInfo.orgId;
    const useV1 = effectiveInfo.version === 'v1' || orgNumeric == null;
    // V1 includes orgId in the body, V2 usually in the URL
    const bodyPayload = (useV1 && effectiveId != null) ? { ...payload, organizationId: effectiveId } : { ...payload };
    
    return externalRequest(url, {
      method,
      headers,
      body: JSON.stringify(bodyPayload),
    });
  },

  tellyoUpdateChannel: async (settings, channelId, payload) => {
    const info = tellyoBaseInfo(settings);
    let orgNumeric = typeof info.orgIdNumeric === 'number' ? info.orgIdNumeric : toNumericOrg(info.orgId);
    if (orgNumeric == null) orgNumeric = await resolveTellyoOrgId(info);
    const effectiveInfo = { ...info, orgIdNumeric: orgNumeric };
    
    const headers = tellyoHeaders(effectiveInfo);
    const { url, method } = tellyoChannelEndpoint(effectiveInfo, channelId);
    
    const effectiveId = orgNumeric ?? effectiveInfo.orgId;
    const useV1 = effectiveInfo.version === 'v1' || orgNumeric == null;
    const bodyPayload = (useV1 && effectiveId != null) ? { ...payload, organizationId: effectiveId } : { ...payload };
    
    return externalRequest(url, {
      method,
      headers,
      body: JSON.stringify(bodyPayload),
    });
  },

  tellyoDeleteChannel: async (settings, channelId) => {
    const info = tellyoBaseInfo(settings);
    let orgNumeric = typeof info.orgIdNumeric === 'number' ? info.orgIdNumeric : toNumericOrg(info.orgId);
    if (orgNumeric == null) orgNumeric = await resolveTellyoOrgId(info);
    const effectiveInfo = { ...info, orgIdNumeric: orgNumeric };
    
    const headers = tellyoHeaders(effectiveInfo);
    const { url } = tellyoChannelEndpoint(effectiveInfo, channelId);
    
    return externalRequest(url, {
      method: 'DELETE',
      headers,
    });
  },

  // --- Testing Methods ---

  testCloudport: async (settings = {}) => {
    const headers = cloudportHeaders(settings);
    delete headers['Content-Type'];
    return externalRequest(cloudportUrl(settings, '?ingest_label=__lec_test__'), { headers });
  },

  testTellyo: async ({ apiEndpoint, apiVersion = 'v2', organizationId, token }) => {
    const info = tellyoBaseInfo({ apiEndpoint, apiVersion, organizationId, token });
    const headers = { 'Tellyo-Token': info.token, 'Content-Type': 'application/json' };

    // V1 Test
    if (info.version === 'v1') {
      const body = info.orgId ? JSON.stringify({ organizationId: toNumericOrg(info.orgId) ?? info.orgId }) : '{}';
      const data = await externalRequest(`${info.baseV1}/organization/get`, {
        method: 'POST',
        headers,
        body,
      });
      const orgs = data?.organizations || [];
      if (!orgs.length) throw new Error(`Organization '${info.orgId || '(any)'}' not found.`);
      return { success: true, message: `Found ${orgs.length} organization(s).` };
    }

    // V2 Test
    const listUrl = `${info.baseV2}/organizations`;
    const data = await externalRequest(listUrl, { headers: { 'Tellyo-Token': info.token } });
    const orgs = data?.organizations || [];
    if (!Array.isArray(orgs)) throw new Error("Unexpected response from Tellyo API (v2).");

    if (!info.orgId) {
      return { success: true, message: `${orgs.length} organization(s) found.` };
    }

    const targetId = toNumericOrg(info.orgId);
    const targetName = String(info.orgId || '').toLowerCase();

    const found = orgs.some(org => 
      (targetId !== null && org.id === targetId) || 
      (String(org.name || '').toLowerCase() === targetName)
    );

    if (found) {
      return { success: true, message: `Organization '${info.orgId}' found.` };
    } else {
      throw new Error(`Organization '${info.orgId}' not found.`);
    }
  },
  
  // Fetch device specific metrics
  getMetrics: (jwt, id, metrics) => {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    return vx(`https://api.videoncloud.com/v1/devices/${encodeURIComponent(id)}/new_metrics`, {
      jwt,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metrics: metrics,
        start_time: fiveMinutesAgo.toISOString(),
        end_time: now.toISOString(),
        interval: "raw",
        statistic: "average"
      }),
    });
  },

  getAvailableMetrics: (jwt, id) =>
    vx(`https://api.videoncloud.com/v1/devices/${encodeURIComponent(id)}/new_metrics`, { jwt }),
};

export const cfgGet = (base, bearer, id) => {
  if (!base) return Promise.resolve({});
  const headers = { Accept: "application/json" };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const url = `${base.replace(/\/$/, "")}/devices/${encodeURIComponent(id)}/config`;
  return fetch(url, { headers }).then(async r => (r.ok ? r.json() : {})).catch(() => ({}));
};