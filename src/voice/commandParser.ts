export type VoiceIntent =
  | { type: 'scroll'; direction: 'up' | 'down' }
  | { type: 'history'; direction: 'back' | 'forward' }
  | { type: 'reload' }
  | { type: 'click'; query?: string }
  | { type: 'focus'; query: string }
  | { type: 'next-field' | 'previous-field' | 'clear-field' | 'cancel' | 'confirm' | 'pause' | 'resume' | 'recenter' | 'help' | 'read-headings' | 'read-important' | 'read-about' | 'read-section' | 'stop-reading' | 'repeat' | 'list-buttons' | 'main-content' | 'new-tab' };

export function parseVoiceCommand(input: string): VoiceIntent | null {
  const text = input.trim().toLowerCase().replace(/[?.!]+$/g, '');
  if (!text) return null;
  if (/^(scroll|go) (down|lower)$/.test(text)) return { type: 'scroll', direction: 'down' };
  if (/^(scroll|go) up$/.test(text)) return { type: 'scroll', direction: 'up' };
  if (/^(go )?back$/.test(text)) return { type: 'history', direction: 'back' };
  if (/^(go )?forward$/.test(text)) return { type: 'history', direction: 'forward' };
  if (/^(reload|refresh)( the page)?$/.test(text)) return { type: 'reload' };
  if (/^(click|activate)( the)?( .+)?$/.test(text)) return { type: 'click', query: text.replace(/^(click|activate)( the)?/, '').trim() || undefined };
  const focus = text.match(/^(focus|select|go to) (?:the )?(.+?)( field)?$/);
  if (focus) return { type: 'focus', query: focus[2].trim() };
  if (/^next field$/.test(text)) return { type: 'next-field' };
  if (/^previous field$/.test(text)) return { type: 'previous-field' };
  if (/^(clear|delete) (the )?(field|input)$/.test(text)) return { type: 'clear-field' };
  if (/^(cancel|stop)$/.test(text)) return { type: 'cancel' };
  if (/^(confirm|submit)$/.test(text)) return { type: 'confirm' };
  if (/^pause$/.test(text)) return { type: 'pause' };
  if (/^resume$/.test(text)) return { type: 'resume' };
  if (/^recenter$/.test(text)) return { type: 'recenter' };
  if (/^(help|what can i say)$/.test(text)) return { type: 'help' };
  if (/^(read )?headings$/.test(text) || text === 'read headings') return { type: 'read-headings' };
  if (/^(read )?(important information|important content)$/.test(text)) return { type: 'read-important' };
  if (/^(what is this page about|read about this page)$/.test(text)) return { type: 'read-about' };
  if (/^read (this )?section$/.test(text)) return { type: 'read-section' };
  if (/^(stop reading|quiet)$/.test(text)) return { type: 'stop-reading' };
  if (/^repeat( that)?$/.test(text)) return { type: 'repeat' };
  if (/^(list|what are) (the )?(available )?buttons$/.test(text)) return { type: 'list-buttons' };
  if (/^(go to )?main content$/.test(text)) return { type: 'main-content' };
  if (/^(open )?new tab$/.test(text)) return { type: 'new-tab' };
  return null;
}
