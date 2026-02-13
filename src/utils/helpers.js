// src/utils/helpers.js

export const auth = t =>
  !t ? "" : (t.startsWith("PAT ") || t.startsWith("Bearer ")
    ? t
    : (t.includes(".") ? `Bearer ${t}` : `PAT ${t}`));

export const ago = iso => {
  if (!iso) return "-";
  const d = Date.now() - Date.parse(iso);
  if (d < 60_000) return "now";
  const m = Math.floor(d / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};

export const uid = () => Math.random().toString(36).slice(2, 9);

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const nextTok = r =>
  r?.pagination_token_next ||
  r?.next_pagination_token ||
  r?.next_page_token ||
  r?.pagination?.next_token ||
  null;

export const parseOutputs = sh => {
  const out = [];
  const walk = o => {
    if (!o || typeof o !== "object") return;
    if ("output_id" in o) {
      const cfg = o.config || {};
      const en = o.enabled ?? o.enable ?? cfg.enabled ?? cfg.enable;
      out.push({
        output_id: +o.output_id,
        name: o.name || "",
        type: (o.type || o.protocol || "").toLowerCase(),
        enabled: !!en,
        port: o.destination_port || o.source_port || o.port || cfg.destination_port || cfg.source_port || cfg.port || null,
        destIp: o.destination_ip || cfg.destination_ip || null,
      });
    }
    Object.values(o).forEach(walk);
  };
  (sh || []).forEach(walk);
  const seen = new Map();
  for (const o of out) {
    const existing = seen.get(o.output_id);
    if (!existing) {
      seen.set(o.output_id, o);
    } else if (o.port && !existing.port) {
      seen.set(o.output_id, o);
    }
  }
  return Array.from(seen.values());
};

export const parseOutputMetrics = (shadows) => {
  if (!shadows) return [];
  const list = Array.isArray(shadows) ? shadows : [shadows];
  const outputs = (list.find(s => s.shadow_name === 'Outputs') || list[0])?.reported?.state;
  if (!Array.isArray(outputs)) return [];
  return outputs.map(o => ({
    output_id: o.output_id || o.id,
    type: (o.type || "").toLowerCase(),
    destination_ip: o.config?.destination_ip,
    destination_port: o.config?.destination_port,
    status: o.status_code,
  }));
};

export const sanitizeLabel = (label, fallback) => {
  const base = (label || fallback || 'lec_ingest').toString().trim();
  return base.replace(/[^A-Za-z0-9_\-]/g, '_').toLowerCase();
};