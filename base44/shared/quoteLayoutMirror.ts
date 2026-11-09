/**
 * Presentation-only Hebrew-to-English mirror for quotation HTML.
 *
 * English quotes use the exact same HTML templates, section order, styles,
 * typography and emphasis as Hebrew quotes.  Mirroring changes only physical
 * start/end placement and RTL direction.  Critically, centered and justified
 * text are NEVER flattened to left, including in user-authored rich text.
 *
 * Applies to CSS declarations in <style> blocks and style="" attributes,
 * as well as legacy align/dir attributes. It never edits visible text,
 * class names, values, URLs, image sources or the Hebrew source records.
 */

const flipSide = (side: string): string =>
  side.toLowerCase() === 'left' ? 'right' : 'left';

const physicalProperties = /^(?:(?:margin|padding|border)-(?:left|right)(?:-(?:color|style|width))?|border-(?:top|bottom)-(?:left|right)-radius|left|right)$/i;

export function mirrorQuoteCssDeclarations(css: string): string {
  return String(css || '').replace(
    /(^|[;{])(\s*)([a-z-]+)(\s*:\s*)([^;}]*)(?=[;}]|$)/gim,
    (full, separator, space, property, colon, value) => {
      const lower = property.toLowerCase();
      let mirroredProperty = property;
      let mirroredValue = value;
      if (physicalProperties.test(property)) {
        mirroredProperty = property.replace(/\b(left|right)\b/gi, side => flipSide(side));
      } else if (lower === 'text-align' || lower === 'float' || lower === 'clear') {
        // center, justify, start and end are intentionally preserved.
        mirroredValue = value.replace(
          /^(\s*)(left|right)(?=\s*(?:!important\s*)?$)/i,
          (_match: string, whitespace: string, side: string) => whitespace + flipSide(side)
        );
      } else if (lower === 'direction') {
        // Explicit RTL in an old rich-text paragraph must not override an
        // English text node. Existing LTR declarations are already correct.
        mirroredValue = value.replace(/^(\s*)rtl(?=\s*(?:!important\s*)?$)/i, '$1ltr');
      }
      if (mirroredProperty === property && mirroredValue === value) return full;
      return separator + space + mirroredProperty + colon + mirroredValue;
    }
  );
}

function mirrorTagAttributes(tag: string): string {
  return tag
    .replace(/(\s+style\s*=\s*)(["'])([\s\S]*?)\2/gi,
      (_full, prefix, quote, value) =>
        prefix + quote + mirrorQuoteCssDeclarations(value) + quote)
    .replace(/(\s+align\s*=\s*)(["'])(left|right)\2/gi,
      (_full, prefix, quote, side) => prefix + quote + flipSide(side) + quote)
    .replace(/(\s+dir\s*=\s*)(["'])rtl\2/gi,
      (_full, prefix, quote) => prefix + quote + 'ltr' + quote);
}

/**
 * Read HTML tags without splitting on ">" within quoted HTML attributes.
 * Preserve the original raw bytes except presentation declarations.
 */
export function mirrorQuoteHtmlPresentation(html: string): string {
  const src = String(html || '');
  let out = '';
  let pos = 0;
  while (pos < src.length) {
    const open = src.indexOf('<', pos);
    if (open < 0) { out += src.slice(pos); break; }
    out += src.slice(pos, open);
    if (src.startsWith('<!--', open)) {
      const end = src.indexOf('-->', open + 4);
      if (end < 0) { out += src.slice(open); break; }
      out += src.slice(open, end + 3);
      pos = end + 3;
      continue;
    }
    let close = open + 1;
    let quote = '';
    for (; close < src.length; close++) {
      const c = src[close];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
    }
    if (close >= src.length) { out += src.slice(open); break; }
    const tag = src.slice(open, close + 1);
    const isStyle = /^<style(?:\s|>)/i.test(tag);
    out += /^<[a-z][\w:-]*/i.test(tag) ? mirrorTagAttributes(tag) : tag;
    pos = close + 1;
    if (isStyle) {
      const remaining = src.slice(pos);
      const end = /<\/style\s*>/i.exec(remaining);
      if (end) {
        out += mirrorQuoteCssDeclarations(remaining.slice(0, end.index));
        out += end[0];
        pos += end.index + end[0].length;
      }
    }
  }
  return out;
}
