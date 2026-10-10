import type { ReactNode } from 'react';
import { Icon } from '../shared/icons';
import { extensionUrl, openDashboardInTab } from '../shared/runtime';

export function Brand() {
  return <div className="brand"><span className="brand-mark"><Icon name="crosshair" /></span><span><strong>HandFree</strong><small>control center</small></span></div>;
}

export function AppShell({ children, compact = false, headerStatus }: { children: ReactNode; compact?: boolean; headerStatus?: ReactNode }) {
  return <div className={compact ? 'app-shell app-shell--compact' : 'app-shell'}><header className="topbar"><Brand /><div className="topbar-actions">{headerStatus && <div className="header-status" role="status">{headerStatus}</div>}<nav aria-label="Dashboard shortcuts" className="topbar-actions"><a className="topbar-action" href={compact ? extensionUrl('dashboard.html#tuning') : '#tuning'} aria-label="Open comfort settings" title="Settings"><Icon name="settings" /></a><a className="topbar-action" href={compact ? extensionUrl('dashboard.html#help') : '#help'} aria-label="Open setup help" title="Help"><Icon name="help" /></a></nav><button className="topbar-action" type="button" onClick={() => void openDashboardInTab()} aria-label="Open HandFree in a full browser tab"><Icon name="external" /><span>Open full page</span></button></div></header>{children}</div>;
}

export function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  return <span className={`status-pill status-pill--${tone}`}><span className="status-dot" aria-hidden="true" />{label}</span>;
}

export function SectionHeading({ eyebrow, title, description }: { eyebrow?: string; title: string; description?: string }) {
  return <div className="section-heading">{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{description && <p>{description}</p>}</div>;
}
