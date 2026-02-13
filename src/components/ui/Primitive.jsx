// src/components/ui/Primitive.jsx
import React from 'react';
import { CL } from './Theme';

export const Button = ({ p = false, className = "", style = {}, ...r }) => (
  <button
    {...r}
    className={(p ? "font-semibold " : "") +
      "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm " +
      (p ? "" : "bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700 ") + className}
    style={p ? { ...style, backgroundColor: "var(--accent,#f97316)", borderColor: "transparent", color: "#000" } : style}
  />
);

export const Switch = ({ checked, onChange }) => (
  <label className="inline-flex items-center cursor-pointer">
    <input type="checkbox" className="peer sr-only" checked={checked} onChange={e => onChange?.(e.target.checked)} />
    <span className="relative h-5 w-9 rounded-full bg-zinc-700 transition peer-checked:bg-orange-500 after:content-[''] after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-black after:transition peer-checked:after:translate-x-4" />
  </label>
);

export const Drawer = ({ open, children, onClose }) => (
  <div className={`fixed inset-0 z-40 ${open ? "" : "pointer-events-none"}`}>
    <div className={`absolute inset-0 bg-black/50 transition ${open ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
    <div className={`absolute right-0 top-0 h-full w-[560px] max-w-[92vw] border-l border-zinc-800 bg-zinc-900 shadow-2xl transition-transform ${open ? "translate-x-0" : "translate-x-full"}`}>
      {children}
    </div>
  </div>
);

export const Modal = ({ open, children, onClose, className }) =>
  open ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className={`mx-4 w-full max-w-lg rounded-xl border bg-zinc-900 p-4 ${className || "border-zinc-800"}`} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  ) : null;

export const ChevronIcon = ({ collapsed }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`h-5 w-5 transition-transform ${collapsed ? 'rotate-180' : ''}`}>
    <path d="M15 18L9 12L15 6" />
  </svg>
);

export const Icon = ({ name, className = "h-5 w-5" }) => {
  if (name === "devices") return (
    <svg className={className} viewBox="0 0 24 24" fill="none"><path d="M3 5h18v10H3zM7 19h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
  );
  if (name === "bell") return (
    <svg className={className} viewBox="0 0 24 24" fill="none"><path d="M6 8a6 6 0 1112 0v6l2 2H4l2-2V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M10 20h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
  );
  if (name === "inputs") return (
    <svg className={className} viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
  );
  if (name === "settings") return (
    <svg className={className} viewBox="0 0 24 24" fill="none"><path d="M12 8a4 4 0 100 8 4 4 0 000-8z" stroke="currentColor" strokeWidth="2"/><path d="M4 12h2M18 12h2M12 4v2M12 18v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
  );
  return null;
};

export const ConfirmModal = ({ open, title, children, onConfirm, onClose, ominous = false }) => (
  <Modal open={open} onClose={onClose} className={ominous ? "border-red-500/50 shadow-[0_0_30px_-5px_rgba(239,68,68,0.3)]" : ""}>
    <div className="space-y-4">
      <div className={`text-lg font-bold flex items-center gap-2 ${ominous ? "text-red-400" : ""}`}>
        {ominous && <svg className="h-6 w-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
        {title}
      </div>
      <div className="text-zinc-300 text-sm leading-relaxed">{children}</div>
      <div className="flex justify-end gap-3 pt-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onConfirm} style={ominous ? { backgroundColor: "#7f1d1d", color: "#fecaca", borderColor: "#991b1b" } : {}}>
          {ominous ? "DELETE" : "Confirm"}
        </Button>
      </div>
    </div>
  </Modal>
);