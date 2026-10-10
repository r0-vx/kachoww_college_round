import { describe, expect, it } from 'vitest';
import { answerPageQuery, rankPageContent } from './pageExtractor';
import type { PageNode } from '../shared/types';

const nodes: PageNode[] = [
  { id: '1', role: 'navigation', accessibleName: 'Menu', text: 'Home About', visible: true, interactive: true, disabled: false, selectorHint: 'nav' },
  { id: '2', role: 'heading', accessibleName: 'Eligibility requirements', text: 'Eligibility requirements', visible: true, interactive: false, disabled: false, selectorHint: 'h2' },
  { id: '3', role: 'main', accessibleName: 'Application', text: 'The deadline is 30 November. Required documents include student proof.', visible: true, interactive: false, disabled: false, selectorHint: 'main' },
  { id: '4', role: 'button', accessibleName: 'Apply now', text: 'Apply now', visible: true, interactive: true, disabled: false, selectorHint: 'button' }
];

describe('page extraction ranking', () => {
  it('prioritizes main content and headings', () => { expect(rankPageContent(nodes, 'deadline')[0]?.role).toBe('main'); });
  it('answers from supplied page content only', () => { expect(answerPageQuery(nodes, 'important information')).toContain('deadline'); expect(answerPageQuery(nodes, 'buttons')).toContain('Apply now'); });
});
