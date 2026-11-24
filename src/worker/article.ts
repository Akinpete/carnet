// Link dumps: fetch a page and keep its article text, with HTMLRewriter
// (Cloudflare's streaming parser: cheap on CPU, which the free plan's 10 ms
// limit needs). Behind `Ctx.web`, so business logic never sees it; the Node
// target (M6) brings its own reader.
import type { Article, ReadResult } from "../server/ctx.ts";

/** Enough for extraction to pick a dump's words from; the opening of the piece. */
export const EXCERPT_CHARS = 1800;
/** Stop reading the page once this much text is in hand. */
const ENOUGH_CHARS = 8000;
const TIMEOUT_MS = 8000;

/** Where an article's text lives, and what to skip on the way. */
const BLOCKS = "p, h1, h2, blockquote";
const SKIP = "nav, header, footer, aside, form, script, style, noscript, figure, button";

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", laquo: "«", raquo: "»",
  ldquo: "“", rdquo: "”", hellip: "…", ndash: "–", mdash: "—", eacute: "é", egrave: "è", ecirc: "ê", agrave: "à",
  acirc: "â", ccedil: "ç", ocirc: "ô", ucirc: "û", ugrave: "ù", icirc: "î", iuml: "ï", euml: "ë", oelig: "œ",
  Eacute: "É", Egrave: "È", Agrave: "À", Ccedil: "Ç",
};

/** HTMLRewriter hands text over with entities still encoded. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code] ?? whole;
  });
}

const clean = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();

/** Short lines that are the site talking, not the article: prompts, consent, subscriptions. */
const INTERFACE = /notification|cookie|abonn|newsletter|inscri|connectez|navigateur|publicit|javascript|partager|commentaire/i;
export const isInterface = (block: string) => block.length < 120 && INTERFACE.test(block);

/** Reject what isn't a public web page: other schemes, bare IPs, localhost. */
export function isFetchable(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname;
    if (host === "localhost" || host.endsWith(".localhost") || !host.includes(".")) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[")) return false;
    return true;
  } catch {
    return false;
  }
}

/** The title plus the opening of the article, from blocks in page order. */
export function excerpt(title: string | null, blocks: readonly string[]): string {
  const out: string[] = title ? [title.replace(/[.!?…]*$/, ".")] : [];
  let length = out.join(" ").length;
  for (const b of blocks) {
    if (title && b === title) continue;
    if (length >= EXCERPT_CHARS) break;
    out.push(b);
    length += b.length + 1;
  }
  return out.join("\n").slice(0, EXCERPT_CHARS + 400);
}

export async function readArticle(url: string, doFetch: typeof fetch = fetch): Promise<ReadResult> {
  if (!isFetchable(url)) return { ok: false, reason: "not_a_page" };
  let res: Response;
  try {
    res = await doFetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; Carnet; language learning)", "accept-language": "fr,en;q=0.5", accept: "text/html" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (res.status === 404 || res.status === 410) return { ok: false, reason: "not_found" };
  if (res.status === 401 || res.status === 403 || res.status === 429) return { ok: false, reason: "blocked" };
  if (!res.ok) return { ok: false, reason: "unreachable" };
  if (!(res.headers.get("content-type") ?? "").includes("html")) return { ok: false, reason: "not_a_page" };

  let title: string | null = null;
  let ogTitle: string | null = null;
  let titleText = "";
  let skipDepth = 0;
  let articleDepth = 0;
  const all: string[] = [];
  const inArticle: string[] = [];
  let open: { text: string; article: boolean } | null = null;
  let total = 0;

  const rewriter = new HTMLRewriter()
    .on('meta[property="og:title"]', {
      element: (el) => {
        ogTitle = el.getAttribute("content");
      },
    })
    .on("title", {
      text: (t) => {
        titleText += t.text;
        if (t.lastInTextNode) title = clean(titleText);
      },
    })
    .on(SKIP, {
      element: (el) => {
        skipDepth++;
        el.onEndTag(() => {
          skipDepth--;
        });
      },
    })
    .on("article, main", {
      element: (el) => {
        articleDepth++;
        el.onEndTag(() => {
          articleDepth--;
        });
      },
    })
    .on(BLOCKS, {
      element: (el) => {
        if (skipDepth > 0) return;
        open = { text: "", article: articleDepth > 0 };
        el.onEndTag(() => {
          const block = open;
          open = null;
          if (!block) return;
          const text = clean(block.text);
          if (text.length < 25 || isInterface(text)) return; // bylines, buttons, the site's own prompts
          all.push(text);
          if (block.article) inArticle.push(text);
          total += text.length;
        });
      },
      text: (t) => {
        if (open && skipDepth === 0) open.text += t.text;
      },
    });

  const reader = rewriter.transform(res).body?.getReader();
  if (!reader) return { ok: false, reason: "no_article" };
  try {
    while (total < ENOUGH_CHARS) {
      const { done } = await reader.read();
      if (done) break;
    }
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally {
    await reader.cancel().catch(() => {});
  }

  // Prefer what's inside <article>/<main>, when there's enough of it.
  const blocks = inArticle.join(" ").length >= 200 ? inArticle : all;
  const heading = ogTitle ? clean(ogTitle) : title;
  const article: Article = { title: heading || null, text: excerpt(heading || null, blocks) };
  if (blocks.join(" ").length < 120) return { ok: false, reason: "no_article" };
  return { ok: true, article };
}
