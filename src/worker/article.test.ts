import { describe, expect, it } from "vitest";
import { decodeEntities, excerpt, isFetchable, isInterface, readArticle } from "./article.ts";

const page = (html: string, init: ResponseInit = {}) =>
  (async () => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" }, ...init })) as unknown as typeof fetch;

const ARTICLE = `<!doctype html><html lang="fr"><head><title>Trains de nuit | Le Journal</title>
<meta property="og:title" content="Pourquoi les trains de nuit reviennent"></head><body>
<header><nav><p>Accueil · Économie · Culture · Se connecter pour lire la suite</p></nav></header>
<main><article><h1>Pourquoi les trains de nuit reviennent</h1>
<p>Par Camille Martin</p>
<p>Activez les notifications et ne manquez rien de l&rsquo;actualité</p>
<p>Après des années d&#39;abandon, les trains de nuit retrouvent la faveur des voyageurs français.</p>
<figure><p>Une légende de photo assez longue pour passer le filtre de longueur.</p></figure>
<p>Face à la hausse des prix de l&rsquo;avion, beaucoup se rendent compte qu&apos;il vaut mieux partir le soir.</p>
<p>Les syndicats saluent une décision attendue depuis longtemps par les cheminots &amp; les usagers.</p>
</article></main>
<aside><p>Lire aussi : dix destinations pour un week-end à petit prix cet hiver.</p></aside>
<footer><p>© Le Journal 2026, tous droits réservés, mentions légales et cookies.</p></footer></body></html>`;

describe("readArticle", () => {
  it("keeps the title and the article's paragraphs, and drops menus, captions, asides and footers", async () => {
    const read = await readArticle("https://journal.example/trains", page(ARTICLE));
    if (!read.ok) throw new Error(`expected an article, got ${read.reason}`);
    expect(read.article.title).toBe("Pourquoi les trains de nuit reviennent");
    expect(read.article.text.split("\n")).toEqual([
      "Pourquoi les trains de nuit reviennent.",
      "Après des années d'abandon, les trains de nuit retrouvent la faveur des voyageurs français.",
      "Face à la hausse des prix de l’avion, beaucoup se rendent compte qu'il vaut mieux partir le soir.",
      "Les syndicats saluent une décision attendue depuis longtemps par les cheminots & les usagers.",
    ]);
  });

  it("leaves out the site's own prompts but keeps article sentences that mention the same words", () => {
    expect(isInterface("Vous pouvez changer d’avis à tout moment dans les réglages de votre navigateur.")).toBe(true);
    expect(isInterface("Abonnez-vous pour lire la suite")).toBe(true);
    const long = "Les cookies de Noël, une tradition venue d'Alsace, se vendent désormais dans toute la France à des prix qui ne cessent de grimper depuis trois ans.";
    expect(isInterface(long)).toBe(false);
  });

  it("names each failure", async () => {
    expect(await readArticle("https://journal.example/x", page("", { status: 404 }))).toEqual({ ok: false, reason: "not_found" });
    expect(await readArticle("https://journal.example/x", page("", { status: 403 }))).toEqual({ ok: false, reason: "blocked" });
    const pdf = (async () => new Response("%PDF", { headers: { "content-type": "application/pdf" } })) as unknown as typeof fetch;
    expect(await readArticle("https://journal.example/x.pdf", pdf)).toEqual({ ok: false, reason: "not_a_page" });
    expect(await readArticle("https://journal.example/app", page("<html><body><div id=root></div></body></html>"))).toEqual({
      ok: false,
      reason: "no_article",
    });
    const down = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    expect(await readArticle("https://journal.example/x", down)).toEqual({ ok: false, reason: "unreachable" });
  });

  it("never fetches local or bare-IP addresses", async () => {
    let fetched = false;
    const spy = (async () => {
      fetched = true;
      return new Response("");
    }) as unknown as typeof fetch;
    for (const url of ["http://localhost:8787/", "http://127.0.0.1/admin", "http://[::1]/", "http://intranet/", "ftp://files.example/a"]) {
      expect(await readArticle(url, spy)).toEqual({ ok: false, reason: "not_a_page" });
    }
    expect(fetched).toBe(false);
    expect(isFetchable("https://www.lemonde.fr/article")).toBe(true);
  });
});

describe("helpers", () => {
  it("decodes the entities French pages use", () => {
    expect(decodeEntities("l&#39;avion &amp; l&rsquo;h&ocirc;tel &laquo;&nbsp;oui&nbsp;&raquo; &#x2014; &bogus;")).toBe(
      "l'avion & l’hôtel « oui » — &bogus;",
    );
  });

  it("stops the excerpt after about 1800 characters, and doesn't repeat the title", () => {
    const blocks = ["Le titre", ...Array.from({ length: 40 }, (_, i) => `Paragraphe ${i} ${"mot ".repeat(20)}`.trim())];
    const text = excerpt("Le titre", blocks);
    expect(text.startsWith("Le titre.\nParagraphe 0")).toBe(true);
    expect(text.length).toBeLessThan(2300);
    expect(text).not.toContain("Paragraphe 39");
  });
});
