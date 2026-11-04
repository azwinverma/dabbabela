import { marked } from "marked";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const SAFE_LINK = /^(https?:|mailto:|tel:|\/(?!\/)|#)/i;
const SAFE_IMG = /^(https:\/\/|\/(?!\/))/i;

/** Render staff-authored markdown. Raw HTML is escaped and URLs are allow-listed, so CMS text can't inject scripts. */
export function md(src: string) {
  const renderer = new marked.Renderer();
  renderer.html = ({ text }) => esc(text);
  renderer.link = ({ href, title, tokens }) => {
    const text = marked.Parser.parseInline(tokens);
    const safe = SAFE_LINK.test(href ?? "") ? href : "#";
    const ext = /^https?:/i.test(safe ?? "");
    return `<a href="${esc(safe ?? "#")}"${title ? ` title="${esc(title)}"` : ""}${ext ? ' target="_blank" rel="noopener noreferrer"' : ""}>${text}</a>`;
  };
  renderer.image = ({ href, title, text }) => {
    if (!SAFE_IMG.test(href ?? "")) return esc(text ?? "");
    return `<img src="${esc(href)}" alt="${esc(text ?? "")}"${title ? ` title="${esc(title)}"` : ""} loading="lazy" />`;
  };
  return marked.parse(src ?? "", { renderer, async: false, gfm: true, breaks: false }) as string;
}
