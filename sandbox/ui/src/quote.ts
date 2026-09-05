// The one-line quote a reply shows above its text (and the composer shows
// while replying or editing): the target's text flattened to one line, or
// its neutral label when it has no text, or a note when it is not here.
import { labelOf, textOf } from '../../lib/markdown.mjs';

import type { Message } from './api';

export const QUOTE_MAX = 120;
export const MISSING_QUOTE = '(message not available)';

export function quoteOf(target: Pick<Message, 'content'> | undefined | null): string {
  if (!target) return MISSING_QUOTE;
  const text = textOf(target.content);
  // A text kind quotes its text even when blank; only textless kinds get a label.
  const line = (text != null ? text : (labelOf(target.content) ?? '')).replace(/\s+/g, ' ').trim();
  if (line === '') return '(empty message)';
  return line.length > QUOTE_MAX ? `${line.slice(0, QUOTE_MAX - 1)}…` : line;
}
