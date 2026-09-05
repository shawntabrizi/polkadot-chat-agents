// A message body: the shared pipeline's sanitized HTML (lib/markdown.mjs),
// bound to this window's DOM for DOMPurify. The daemon's html route renders
// the same module, so what a test asserts on there is what shows here.
import { createMarkdown } from '../../lib/markdown.mjs';

const markdown = createMarkdown(window);

export const renderMarkdown = (text: string | null | undefined): string => markdown.render(text);

export const MarkdownCell = ({ text }: { text: string | null | undefined }) => (
  // The HTML was sanitized by DOMPurify; nothing else ever goes in here.
  <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
);
