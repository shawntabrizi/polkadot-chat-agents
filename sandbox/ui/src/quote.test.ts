// A reply's quote must be one readable line whatever the target holds, and
// must say so when the target is not in the room (a reply to something
// this device never received).
import { describe, expect, it } from 'vitest';

import { MISSING_QUOTE, QUOTE_MAX, quoteOf } from './quote';

describe('quoteOf', () => {
  it('flattens the target text to one line', () => {
    expect(quoteOf({ content: { type: 'text', text: 'a\n\n| t |\n|---|\n| b |' } })).toBe('a | t | |---| | b |');
    expect(quoteOf({ content: { type: 'reply', messageId: 'x', text: '  re  ' } })).toBe('re');
  });
  it('truncates a long target with an ellipsis', () => {
    const quote = quoteOf({ content: { type: 'text', text: 'x'.repeat(QUOTE_MAX + 50) } });
    expect(quote.length).toBe(QUOTE_MAX);
    expect(quote.endsWith('…')).toBe(true);
  });
  it('uses the neutral label when the target has no text', () => {
    expect(quoteOf({ content: { type: 'contactAdded' } })).toBe('Chat accepted');
    expect(quoteOf({ content: { type: 'unsupported', tag: 'coinagePayment' } })).toBe('Unsupported message (coinagePayment)');
    expect(quoteOf({ content: { type: 'text', text: '   ' } })).toBe('(empty message)');
  });
  it('says when the target is missing', () => {
    expect(quoteOf(undefined)).toBe(MISSING_QUOTE);
    expect(quoteOf(null)).toBe(MISSING_QUOTE);
  });
});
