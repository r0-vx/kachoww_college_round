import type { ReactNode } from 'react';
import { Icon } from '../shared/icons';

export function Brand() {
  return <div className="brand"><span className="brand-mark"><Icon name="crosshair" /></span><span><strong>HandFree</strong><small>control center</small></span></div>;
}

export function AppShell({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return <div className={compact ? 'app-shell app-shell--compact' : 'app-shell'}><header className="topbar"><Brand /><span className="build-label">MVP · in-page control only</span></header>{children}</div>;
}

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  return <span className={`status-pill status-pill--${tone}`}><span className="status-dot" aria-hidden="true" />{label}</span>;
}

export function SectionHeading({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) {
  return <div className="section-heading">{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{description && <p>{description}</p>}</div>;
}
