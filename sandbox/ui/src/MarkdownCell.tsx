// A message body: the shared pipeline's sanitized HTML (lib/markdown.mjs),
// bound to this window's DOM for DOMPurify. The daemon's html route renders
// the same module, so what a test asserts on there is what shows here.
//
// The HTML is inert; this cell gives its two controls a behaviour: a code
// block's Copy button, and a /command, which the room sends as the phone
// would on a tap.
import { type MouseEvent, useLayoutEffect, useRef } from 'react';

import { createMarkdown } from '../../lib/markdown.mjs';

const markdown = createMarkdown(window);

export const renderMarkdown = (text: string | null | undefined): string => markdown.render(text);

/** One line of plain text for a chat-list preview or a reply quote. */
export const plainText = (text: string | null | undefined): string => markdown.plain(text);

type Props = { text: string | null | undefined; onCommand?: (command: string) => void };

// The boxes that scroll sideways. One that has more to its right is flagged,
// and the stylesheet fades that edge: a phone shows no scrollbar to say so.
const SCROLLERS = '.md-table, pre, .md-math';
const flagMore = (el: Element) => el.toggleAttribute('data-more', el.scrollLeft + el.clientWidth < el.scrollWidth - 1);

export const MarkdownCell = ({ text, onCommand }: Props) => {
  const root = useRef<HTMLDivElement>(null);
  const html = renderMarkdown(text);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const update = () => el.querySelectorAll(SCROLLERS).forEach(flagMore);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [html]);
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const copy = target.closest<HTMLElement>('[data-copy]');
    if (copy) {
      const code = copy.closest('.md-code')?.querySelector('code')?.textContent ?? '';
      void navigator.clipboard.writeText(code).then(() => {
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy'), 1500);
      });
      return;
    }
    const command = target.closest<HTMLElement>('[data-command]')?.dataset.command;
    if (command) onCommand?.(command);
  };
  // The HTML was sanitized by DOMPurify; nothing else ever goes in here.
  return <div ref={root} className="md" onClick={onClick} onScrollCapture={event => flagMore(event.target as Element)} dangerouslySetInnerHTML={{ __html: html }} />;
};
