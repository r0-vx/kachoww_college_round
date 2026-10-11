import { answerPageQuery, extractPageIndex } from '../accessibility/pageExtractor';
import { parseVoiceCommand, type VoiceIntent } from '../voice/commandParser';
import { sendMessage } from '../shared/runtime';
import type { PageNode, HandFreeMessage } from '../shared/types';

let pendingTarget: HTMLElement | null = null;
let lastSpoken = '';

function nameOf(element: HTMLElement): string { return element.getAttribute('aria-label') || element.getAttribute('title') || (element as HTMLInputElement).labels?.[0]?.textContent?.trim() || element.textContent?.trim() || element.tagName.toLowerCase(); }
function speak(message: string): void { lastSpoken = message; if ('speechSynthesis' in window) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(message)); } }
function result(message: string, success = true, speakResult = true): void { lastSpoken = message; void sendMessage({ type: 'VOICE_COMMAND_RESULT', success, message, speak: speakResult }); }
function interactiveMatches(query?: string): HTMLElement[] {
  const elements = Array.from(document.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,[role="button"],[onclick]')).filter((element) => !element.hidden && !(element as HTMLButtonElement).disabled && element.getAttribute('aria-disabled') !== 'true');
  if (!query) return elements;
  const wanted = query.toLowerCase();
  const roleFree = wanted.replace(/\b(button|link|field|input|control)\b/g, '').replace(/\s+/g, ' ').trim();
  return elements.filter((element) => {
    const name = nameOf(element).toLowerCase();
    const fieldName = element.getAttribute('name')?.toLowerCase() ?? '';
    return name.includes(wanted) || fieldName.includes(wanted) || Boolean(roleFree && (name.includes(roleFree) || fieldName.includes(roleFree)));
  });
}
function executeIntent(intent: VoiceIntent): void {
  switch (intent.type) {
    case 'review-form': {
      const review = interactiveMatches('review submission');
      if (review.length === 1) { review[0].click(); result('Review the form, then confirm submission.'); }
      else result('No unique form review control is available.', false);
      break;
    }
    case 'scroll': window.scrollBy({ top: intent.direction === 'down' ? window.innerHeight * .8 : -window.innerHeight * .8, behavior: 'smooth' }); result(`Scrolled ${intent.direction}.`); break;
    case 'history': intent.direction === 'back' ? window.history.back() : window.history.forward(); result(`Going ${intent.direction}.`, true, false); break;
    case 'reload': window.location.reload(); break;
    case 'new-tab': void sendMessage({ type: 'OPEN_NEW_TAB' }); result('Opening a new tab.', true, false); break;
    case 'pause': void sendMessage({ type: 'PAUSE_INTERACTION', reason: 'Voice command' }); result('Interaction paused.'); break;
    case 'resume': void sendMessage({ type: 'RESUME_INTERACTION' }); result('Interaction resumed.'); break;
    case 'recenter': void sendMessage({ type: 'RECENTER_POINTER' }); result('Pointer recentered.'); break;
    case 'stop-reading': window.speechSynthesis?.cancel(); result('Reading stopped.', true, false); break;
    case 'repeat': speak(lastSpoken || 'There is nothing to repeat yet.'); result(lastSpoken || 'There is nothing to repeat yet.', Boolean(lastSpoken), false); break;
    case 'help': result('You can say scroll down, click a button, focus a field, pause, resume, recenter, read headings, or stop reading.'); break;
    case 'focus': {
      const matches = interactiveMatches(intent.query).filter((element) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName));
      if (matches.length !== 1) { result(matches.length > 1 ? `I found ${matches.length} matching fields. Please be more specific.` : `I could not find a field named ${intent.query}.`, false); break; }
      matches[0].focus(); void sendMessage({ type: 'ANALYTICS_EVENT', event: { type: 'field-focused', timestamp: Date.now(), outcome: 'success' } }); result(`Focused ${nameOf(matches[0])}.`); break;
    }
    case 'next-field': { const fields = Array.from(document.querySelectorAll<HTMLElement>('input,select,textarea')).filter((element) => !element.hidden && !(element as HTMLInputElement).disabled); const index = fields.indexOf(document.activeElement as HTMLElement); fields[(index + 1) % fields.length]?.focus(); result('Moved to the next field.'); break; }
    case 'previous-field': { const fields = Array.from(document.querySelectorAll<HTMLElement>('input,select,textarea')).filter((element) => !element.hidden && !(element as HTMLInputElement).disabled); const index = fields.indexOf(document.activeElement as HTMLElement); fields[(index - 1 + fields.length) % fields.length]?.focus(); result('Moved to the previous field.'); break; }
    case 'clear-field': { const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null; if (!active || !('value' in active)) result('No editable field is focused.', false); else { setFieldValue(active, ''); result('Field cleared.'); } break; }
    case 'cancel': pendingTarget = null; void sendMessage({ type: 'CANCEL_DWELL' }); result('Cancelled.'); break;
    case 'confirm': {
      const dialogConfirm = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] button')).filter(button => /confirm submission/i.test(nameOf(button)));
      const target = pendingTarget ?? (dialogConfirm.length === 1 ? dialogConfirm[0] : null);
      if (target?.isConnected) { target.click(); pendingTarget = null; void sendMessage({ type: 'ANALYTICS_EVENT', event: { type: 'submission-confirmed', timestamp: Date.now(), outcome: 'success' } }); result('Confirmed.'); }
      else result('There is nothing waiting for confirmation.', false);
      break;
    }
    case 'click': {
      const matches = interactiveMatches(intent.query);
      if (matches.length === 0) result(intent.query ? `I could not find ${intent.query}.` : 'I could not find an available control.', false);
      else if (matches.length > 1) { result(`I found ${matches.length} matching controls. Please say a more specific name.`, false); void sendMessage({ type: 'ANALYTICS_EVENT', event: { type: 'clarification-requested', timestamp: Date.now(), outcome: 'ambiguous' } }); }
      else if (/submit|send|apply|save/i.test(nameOf(matches[0]))) { pendingTarget = matches[0]; result(`I found ${nameOf(matches[0])}. Say confirm to activate it.`); }
      else { matches[0].click(); result(`${nameOf(matches[0])} activated.`); }
      break;
    }
    case 'read-headings': result(answerPageQuery(extractPageIndex(), 'headings')); break;
    case 'list-buttons': result(answerPageQuery(extractPageIndex(), 'buttons')); break;
    case 'read-important': result(answerPageQuery(extractPageIndex(), 'important information')); break;
    case 'read-about': result(answerPageQuery(extractPageIndex(), 'page about')); break;
    case 'read-section': { const selected = window.getSelection()?.anchorNode?.parentElement; const section = selected?.closest('section,article,main') ?? document.querySelector('main'); result(section?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 900) || 'I could not find a section to read.'); break; }
    case 'main-content': { const main = document.querySelector<HTMLElement>('main,[role="main"]'); main?.scrollIntoView({ behavior: 'smooth' }); result(main ? 'Moved to main content.' : 'There is no main content landmark.', Boolean(main)); break; }
  }
}

export function handleVoiceTranscript(transcript: string): void {
  const intent = parseVoiceCommand(transcript);
  if (!intent) { result(`I did not understand “${transcript}”. Say help for examples.`, false); return; }
  executeIntent(intent);
  void sendMessage({ type: 'ANALYTICS_EVENT', event: { type: 'voice-command-executed', timestamp: Date.now(), outcome: 'success' } });
}

function setFieldValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export function handleDictation(text: string, isFinal: boolean): void {
  // Interim transcripts are preview-only; appending them duplicates dictation.
  if (!isFinal) return;
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  if (!(active instanceof HTMLTextAreaElement) && !(active instanceof HTMLInputElement && ['text', 'search', 'email', 'url', 'tel', 'password'].includes(active.type))) { result('Focus an editable text field before dictation.', false); return; }
  if (active.disabled || active.readOnly) { result('This field is not editable.', false); return; }
  const start = active.selectionStart ?? active.value.length;
  const end = active.selectionEnd ?? active.value.length;
  setFieldValue(active, `${active.value.slice(0, start)}${text}${active.value.slice(end)}`);
  active.setSelectionRange(start + text.length, start + text.length);
  active.dispatchEvent(new Event('input', { bubbles: true }));
  if (isFinal) void sendMessage({ type: 'ANALYTICS_EVENT', event: { type: 'field-focused', timestamp: Date.now(), outcome: 'success', metadata: { dictation: true } } });
}

export function pageNodes(): PageNode[] { return extractPageIndex(); }
export function handleSenseQuery(query: string): Extract<HandFreeMessage, { type: 'SENSE_RESPONSE' }> {
  const nodes = extractPageIndex().filter(node => node.visible);
  return { type: 'SENSE_RESPONSE', message: answerPageQuery(nodes, query), nodes };
}
