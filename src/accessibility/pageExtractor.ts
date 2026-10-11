import type { PageNode } from '../shared/types';

const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
const LANDMARK_ROLES = new Set(['main', 'navigation', 'banner', 'contentinfo', 'complementary', 'region', 'form', 'search']);

function getRole(element: HTMLElement): string {
  const explicit = element.getAttribute('role');
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') return 'heading';
  if (tag === 'a' && element.hasAttribute('href')) return 'link';
  if (tag === 'button' || tag === 'summary') return 'button';
  if (tag === 'form') return 'form';
  if (LANDMARK_ROLES.has(tag)) return tag;
  return tag;
}

function getAccessibleName(element: HTMLElement): string {
  return element.getAttribute('aria-label') || element.getAttribute('title') || (element as HTMLInputElement).labels?.[0]?.textContent?.trim() || element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120) || element.tagName.toLowerCase();
}

export function extractPageIndex(root: ParentNode = document): PageNode[] {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,p,main,nav,header,footer,aside,section,article,form,button,a[href],input,select,textarea,ul,ol,li,label,[role],table,th,td,[aria-live]'));
  let section = '';
  return elements.map((element, index) => {
    const role = getRole(element);
    if (['heading', 'main', 'navigation', 'region', 'form'].includes(role)) section = getAccessibleName(element);
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const visible = !element.hidden && rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    const interactive = INTERACTIVE.has(element.tagName) || role === 'button' || role === 'link' || Boolean(element.onclick);
    return { id: `hf-${index + 1}`, role, accessibleName: getAccessibleName(element), text: element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 280) || '', visible, interactive, disabled: Boolean((element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true'), parentSection: section || undefined, selectorHint: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}` };
  });
}

export function rankPageContent(nodes: PageNode[], query = ''): PageNode[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return nodes.map((node, index) => {
    let score = 0;
    if (node.role === 'main') score += 10;
    if (node.role === 'heading') score += 6;
    if (node.role === 'alert' || node.role === 'status') score += 8;
    if (node.interactive) score += 2;
    if (/deadline|eligib|document|requirement|fee|award|apply|application/i.test(`${node.accessibleName} ${node.text}`)) score += 5;
    if (/advert|footer|cookie|sign in|log in/i.test(`${node.accessibleName} ${node.text}`)) score -= 3;
    score += terms.filter((term) => `${node.accessibleName} ${node.text}`.toLowerCase().includes(term)).length * 4;
    return { node, score, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index).map(({ node }) => node);
}

export function answerPageQuery(nodes: PageNode[], query: string): string {
  const lower = query.toLowerCase();
  if (/heading/.test(lower)) return rankPageContent(nodes.filter((node) => node.role === 'heading')).map((node) => node.accessibleName).filter(Boolean).join('. ') || 'There are no headings on this page.';
  if (/button/.test(lower)) return rankPageContent(nodes.filter((node) => node.role === 'button' && node.visible && !node.disabled)).map((node) => node.accessibleName).filter(Boolean).join(', ') || 'There are no available buttons.';
  const focused = nodes.filter((node) => node.visible && node.text && !['main', 'article', 'section', 'nav', 'header', 'footer', 'form', 'ul', 'ol'].includes(node.role));
  if (/deadline/.test(lower)) {
    const sectionMatches = focused.filter((node) => /application deadline/i.test(node.parentSection ?? ''));
    const matches = sectionMatches.length ? sectionMatches : focused.filter((node) => /deadline/i.test(`${node.accessibleName} ${node.text}`));
    return rankPageContent(matches, 'deadline').slice(0, 2).map((node) => node.text || node.accessibleName).join('. ') || 'I could not find a deadline on this page.';
  }
  if (/eligib/.test(lower)) {
    const sectionMatches = focused.filter((node) => /eligib/i.test(node.parentSection ?? ''));
    const matches = sectionMatches.length ? sectionMatches : focused.filter((node) => /eligib/i.test(`${node.accessibleName} ${node.text}`));
    return rankPageContent(matches, 'eligibility').slice(0, 3).map((node) => node.text || node.accessibleName).join('. ') || 'I could not find eligibility requirements on this page.';
  }
  if (/document|requirement/.test(lower)) {
    const sectionMatches = focused.filter((node) => /document|requirement/i.test(node.parentSection ?? ''));
    const matches = sectionMatches.length ? sectionMatches : focused.filter((node) => /document|requirement/i.test(`${node.accessibleName} ${node.text}`));
    return rankPageContent(matches, 'documents').slice(0, 5).map((node) => node.text || node.accessibleName).join('. ') || 'I could not find required documents on this page.';
  }
  if (/where.*apply|application link|apply/.test(lower)) {
    const sectionMatches = focused.filter((node) => /apply|application|contact/i.test(node.parentSection ?? ''));
    const matches = sectionMatches.length ? sectionMatches : focused.filter((node) => /apply|application|contact/i.test(`${node.accessibleName} ${node.text}`));
    return rankPageContent(matches, 'apply').slice(0, 4).map((node) => node.text || node.accessibleName).join('. ') || 'I could not find an application link on this page.';
  }
  if (/important|deadline|eligib|document|requirement|fee|award|apply/.test(lower)) return rankPageContent(nodes, lower).filter((node) => node.text).slice(0, 6).map((node) => node.text || node.accessibleName).join('. ') || 'I could not find important information on this page.';
  return rankPageContent(nodes, lower).filter((node) => node.text).slice(0, 4).map((node) => node.text || node.accessibleName).join('. ') || 'I could not find enough page content to summarize.';
}
