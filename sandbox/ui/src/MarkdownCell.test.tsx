// The markdown cell renders the shared pipeline's HTML: a table is a table,
// a code block keeps its language, a script never becomes an element, and an
// empty message shows its placeholder.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MarkdownCell } from './MarkdownCell';

const render = (text: string | null) => renderToStaticMarkup(<MarkdownCell text={text} />);

describe('MarkdownCell', () => {
  it('renders a table and a fenced code block', () => {
    const html = render('| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nlet x = 1 < 2;\n```');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>2</td>');
    expect(html).toContain('<pre><code class="language-js">let x = 1 &lt; 2;\n</code></pre>');
  });
  it('sanitizes markup and links safely', () => {
    const html = render('<script>alert(1)</script> [x](javascript:alert(1)) https://example.com');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a>');
  });
  it('shows a neutral placeholder for empty text', () => {
    expect(render('')).toContain('<p class="md-empty">(empty message)</p>');
    expect(render(null)).toContain('(empty message)');
  });
});
