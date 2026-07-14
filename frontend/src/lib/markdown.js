"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderInlineText = renderInlineText;
exports.renderMarkdown = renderMarkdown;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = __importDefault(require("react"));
// Minimal, safe markdown rendering for assistant chat replies and published
// blog bodies. Builds JSX directly (no dangerouslySetInnerHTML), so there is
// no HTML-injection surface even though the source text is model- or
// user-authored.
//
// Supports, with a single shared inline pass:
//   - **bold**
//   - *italic*  (single asterisk; a leading "* " is also a bullet — handled
//     at the block level, not here, so inline emphasis still works)
//   - `inline code`
//   - hard line breaks (a single newline inside a paragraph keeps its break)
//   - fenced code blocks ```...```
//   - bulleted lists  (-, *, or +) and numbered lists (1. 2. ...)
//
// Anything it does not understand is passed through as plain text rather
// than shown raw — so a literal "*" is never rendered as a visible asterisk
// artifact.
function renderInline(text, keyPrefix) {
    const nodes = [];
    // Order matters: fenced/inline code first so we don't parse * inside code.
    const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
    let last = 0;
    let m;
    let k = 0;
    while ((m = pattern.exec(text)) !== null) {
        if (m.index > last)
            nodes.push(text.slice(last, m.index));
        const tok = m[0];
        const key = `${keyPrefix}-i${k++}`;
        if (tok.startsWith('**')) {
            nodes.push((0, jsx_runtime_1.jsx)("strong", { children: tok.slice(2, -2) }, key));
        }
        else if (tok.startsWith('`')) {
            nodes.push((0, jsx_runtime_1.jsx)("code", { className: "md-inline-code", children: tok.slice(1, -1) }, key));
        }
        else {
            nodes.push((0, jsx_runtime_1.jsx)("em", { children: tok.slice(1, -1) }, key));
        }
        last = m.index + tok.length;
    }
    if (last < text.length)
        nodes.push(text.slice(last));
    return nodes;
}
function renderBlock(block, bi) {
    const lines = block.split('\n');
    // Fenced code block
    if (lines[0]?.trim().startsWith('```')) {
        const body = lines.slice(1).filter(l => !l.trim().startsWith('```')).join('\n');
        return (0, jsx_runtime_1.jsx)("pre", { className: "md-codeblock", children: (0, jsx_runtime_1.jsx)("code", { children: body }) }, bi);
    }
    const trimmed = lines.map(l => l.trim());
    const nonEmpty = trimmed.filter(l => l !== '');
    // A block is a clean list only if EVERY non-empty line is a list item.
    const isNumbered = nonEmpty.length > 0 && nonEmpty.every(l => /^\d+\.\s/.test(l));
    const isBulleted = nonEmpty.length > 0 && nonEmpty.every(l => /^[-*+]\s/.test(l));
    if (isNumbered) {
        return ((0, jsx_runtime_1.jsx)("ol", { children: nonEmpty.map((l, li) => ((0, jsx_runtime_1.jsx)("li", { children: renderInline(l.replace(/^\d+\.\s/, ''), `${bi}-${li}`) }, li))) }, bi));
    }
    if (isBulleted) {
        return ((0, jsx_runtime_1.jsx)("ul", { children: nonEmpty.map((l, li) => ((0, jsx_runtime_1.jsx)("li", { children: renderInline(l.replace(/^[-*+]\s/, ''), `${bi}-${li}`) }, li))) }, bi));
    }
    // Paragraph with hard line breaks preserved.
    return ((0, jsx_runtime_1.jsx)("p", { children: lines.map((l, li) => ((0, jsx_runtime_1.jsxs)(react_1.default.Fragment, { children: [renderInline(l, `${bi}-${li}`), li < lines.length - 1 && (0, jsx_runtime_1.jsx)("br", {})] }, li))) }, bi));
}
function renderInlineText(text, keyPrefix) {
    return renderInline(text, keyPrefix);
}
function renderMarkdown(text) {
    // Split into blocks on blank lines, but keep fenced code blocks intact.
    const blocks = [];
    let buf = [];
    let inFence = false;
    for (const line of text.split('\n')) {
        if (line.trim().startsWith('```')) {
            if (inFence) {
                buf.push(line);
                blocks.push(buf.join('\n'));
                buf = [];
                inFence = false;
            }
            else {
                if (buf.length) {
                    blocks.push(buf.join('\n'));
                    buf = [];
                }
                buf.push(line);
                inFence = true;
            }
            continue;
        }
        if (inFence) {
            buf.push(line);
            continue;
        }
        if (line.trim() === '') {
            if (buf.length) {
                blocks.push(buf.join('\n'));
                buf = [];
            }
        }
        else {
            buf.push(line);
        }
    }
    if (buf.length)
        blocks.push(buf.join('\n'));
    return blocks.map((b, bi) => renderBlock(b, bi));
}
