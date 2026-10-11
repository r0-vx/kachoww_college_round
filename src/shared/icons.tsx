import type { SVGProps } from 'react';

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: 'arrow' | 'camera' | 'check' | 'chevron' | 'crosshair' | 'external' | 'help' | 'info' | 'mic' | 'pause' | 'play' | 'refresh' | 'settings' | 'shield' | 'target' | 'warning' }) {
  const paths: Record<string, string> = {
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    camera: 'M4 7h3l1.5-2h5L15 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm8 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
    check: 'm5 12 4 4L19 6',
    chevron: 'm7 10 5 5 5-5',
    crosshair: 'M12 2v4m0 12v4M2 12h4m12 0h4M12 7a5 5 0 1 0 0 10 5 5 0 0 0-0-10Z',
    external: 'M14 3h7v7m0-7-9 9m5 5v3H4V4h3',
    help: 'M9.5 9a2.5 2.5 0 1 1 4.3 1.7c-1.1.6-1.8 1.2-1.8 2.3m0 3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    info: 'M12 16v-4m0-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0m-7 7v3m-4 0h8',
    pause: 'M8 5v14m8-14v14',
    play: 'm8 5 11 7-11 7V5Z',
    refresh: 'M20 11a8 8 0 1 0 1 4m-1-9v5h-5',
    settings: 'M4 7h16M4 17h16M9 4v6m6 4v6',
    shield: 'M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z',
    target: 'M12 5a7 7 0 1 0 7 7m-7-3v3l2 2',
    warning: 'M12 4 2.5 20h19L12 4Zm0 6v4m0 3h.01'
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}><path d={paths[name]} /></svg>;
}
