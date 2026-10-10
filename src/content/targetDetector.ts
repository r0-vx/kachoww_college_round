import type { TargetInfo } from '../shared/types';

const INTERACTIVE_SELECTOR = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [onclick], [tabindex="0"]';

function accessibleName(element: HTMLElement): string {
  const labelledBy = element.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
  const associatedLabel = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent?.trim() : undefined;
  return element.getAttribute('aria-label') || labelledBy || associatedLabel || element.closest('label')?.textContent?.trim() || element.getAttribute('title') || element.getAttribute('placeholder') || element.textContent?.trim().slice(0, 160) || element.tagName.toLowerCase();
}

export function findTargetAt(x: number, y: number): { element: HTMLElement; info: TargetInfo } | null {
  const element = document.elementFromPoint(x, y);
  if (!(element instanceof HTMLElement)) return null;
  if (element.closest('#handfree-touchview-root, #handfree-pointer')) return null;
  let target = element.closest(INTERACTIVE_SELECTOR) as HTMLElement | null;
  if (!target) {
    // Property handlers have no [onclick] attribute; delegated custom controls
    // often advertise their click affordance through a pointer cursor.
    for (let candidate: HTMLElement | null = element; candidate && candidate !== document.body && candidate !== document.documentElement; candidate = candidate.parentElement) {
      if (typeof candidate.onclick === 'function' || getComputedStyle(candidate).cursor === 'pointer') { target = candidate; break; }
    }
  }
  if (!target || target.getAttribute('aria-disabled') === 'true' || (target as HTMLButtonElement).disabled || target.hidden || getComputedStyle(target).display === 'none' || getComputedStyle(target).visibility === 'hidden') return null;
  const rect = target.getBoundingClientRect();
  if (getComputedStyle(target).opacity === '0' || target.closest('[inert]') || rect.width === 0 || rect.height === 0 || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return null;
  return {
    element: target,
    info: { selectorHint: `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}`, accessibleName: accessibleName(target), tagName: target.tagName.toLowerCase() }
  };
}
