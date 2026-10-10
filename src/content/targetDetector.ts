import type { TargetInfo } from '../shared/types';

const INTERACTIVE_SELECTOR = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [onclick]';

function accessibleName(element: HTMLElement): string {
  const labelledBy = element.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
  const associatedLabel = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent?.trim() : undefined;
  return element.getAttribute('aria-label') || labelledBy || associatedLabel || element.getAttribute('title') || (element as HTMLInputElement).value || element.getAttribute('placeholder') || element.textContent?.trim() || element.tagName.toLowerCase();
}

export function findTargetAt(x: number, y: number): { element: HTMLElement; info: TargetInfo } | null {
  const element = document.elementFromPoint(x, y);
  if (!(element instanceof HTMLElement)) return null;
  const target = element.closest(INTERACTIVE_SELECTOR) as HTMLElement | null;
  if (!target || target.getAttribute('aria-disabled') === 'true' || (target as HTMLButtonElement).disabled || target.hidden || getComputedStyle(target).display === 'none' || getComputedStyle(target).visibility === 'hidden') return null;
  const rect = target.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    element: target,
    info: { selectorHint: `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}`, accessibleName: accessibleName(target), tagName: target.tagName.toLowerCase() }
  };
}
