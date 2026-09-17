/* Sparks catalog - safe Markdown renderer.
 *
 * Zero dependencies. The renderer escapes every line before adding markup, so
 * the only HTML it can ever emit is the tag set below. Link targets are
 * restricted to safe schemes; anything else degrades to plain text.
 */

(function (Sparks) {
  'use strict';

  var escapeHtml = Sparks.util.escapeHtml;

  function isSafeHref(href) {
    return /^(https?:\/\/|mailto:|#|\/|\.\/)/i.test(String(href || ''));
  }

  // Both arguments are already HTML-escaped by the caller.
  function markdownLinkHtml(label, href) {
    return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
  }

  function markdownLinkText(label, href) {
    return label + ' (' + href + ')';
  }

  // Input must already be HTML-escaped. Only inline markup is added here.
  function formatInlineMarkdown(text) {
    return String(text)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (match, label, href) {
        return isSafeHref(href) ? markdownLinkHtml(label, href) : markdownLinkText(label, href);
      })
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  }

  function renderMarkdown(md) {
    if (!md) return '<p><em>No README documentation available for this spark.</em></p>';

    var lines = String(md).replace(/\r\n/g, '\n').split('\n');
    var out = [];
    var inCodeBlock = false;
    var codeBuffer = [];
    var listTag = null; // 'ul' | 'ol' | null

    function closeList() {
      if (listTag) {
        out.push(listTag === 'ul' ? '</ul>' : '</ol>');
        listTag = null;
      }
    }

    function openList(tag) {
      if (listTag !== tag) {
        closeList();
        out.push(tag === 'ul' ? '<ul>' : '<ol>');
        listTag = tag;
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var rawLine = lines[i];

      if (rawLine.trim().startsWith('```')) {
        if (inCodeBlock) {
          inCodeBlock = false;
          out.push('<pre><code>' + escapeHtml(codeBuffer.join('\n')) + '</code></pre>');
          codeBuffer = [];
        } else {
          inCodeBlock = true;
          codeBuffer = [];
        }
        closeList();
        continue;
      }

      if (inCodeBlock) {
        codeBuffer.push(rawLine);
        continue;
      }

      var trimmed = rawLine.trim();
      if (!trimmed) {
        closeList();
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        closeList();
        out.push('<hr>');
      } else if (trimmed.startsWith('#### ')) {
        closeList();
        out.push('<h4>' + formatInlineMarkdown(escapeHtml(trimmed.substring(5))) + '</h4>');
      } else if (trimmed.startsWith('### ')) {
        closeList();
        out.push('<h3>' + formatInlineMarkdown(escapeHtml(trimmed.substring(4))) + '</h3>');
      } else if (trimmed.startsWith('## ')) {
        closeList();
        out.push('<h2>' + formatInlineMarkdown(escapeHtml(trimmed.substring(3))) + '</h2>');
      } else if (trimmed.startsWith('# ')) {
        closeList();
        out.push('<h1>' + formatInlineMarkdown(escapeHtml(trimmed.substring(2))) + '</h1>');
      } else if (trimmed.startsWith('> ')) {
        closeList();
        out.push('<blockquote>' + formatInlineMarkdown(escapeHtml(trimmed.substring(2))) + '</blockquote>');
      } else if (/^[-*+]\s+/.test(trimmed)) {
        openList('ul');
        out.push('<li>' + formatInlineMarkdown(escapeHtml(trimmed.replace(/^[-*+]\s+/, ''))) + '</li>');
      } else if (/^\d+[.)]\s+/.test(trimmed)) {
        openList('ol');
        out.push('<li>' + formatInlineMarkdown(escapeHtml(trimmed.replace(/^\d+[.)]\s+/, ''))) + '</li>');
      } else {
        closeList();
        out.push('<p>' + formatInlineMarkdown(escapeHtml(trimmed)) + '</p>');
      }
    }

    if (inCodeBlock && codeBuffer.length) {
      out.push('<pre><code>' + escapeHtml(codeBuffer.join('\n')) + '</code></pre>');
    }
    closeList();

    return out.join('\n');
  }

  Sparks.markdown = {
    isSafeHref: isSafeHref,
    markdownLinkHtml: markdownLinkHtml,
    markdownLinkText: markdownLinkText,
    formatInlineMarkdown: formatInlineMarkdown,
    renderMarkdown: renderMarkdown
  };
})(window.Sparks);
