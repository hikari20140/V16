function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createV16DocumentAPI(documentLike = null) {
  const state = {
    document: documentLike,
    html: typeof documentLike === "string" ? documentLike : null
  };

  const api = {
    bind(documentObject) {
      state.document = documentObject;
      if (typeof documentObject === "string") {
        state.html = documentObject;
      }
      return api;
    },
    getDocument() {
      return state.document;
    },
    hasDocument() {
      return !!state.document || typeof state.html === "string";
    },
    getHTML() {
      if (typeof state.html === "string") return state.html;
      const doc = state.document;
      if (!doc) return "";
      if (typeof doc === "string") return doc;
      if (typeof doc.serialize === "function") return doc.serialize();
      if (doc.documentElement?.outerHTML) return doc.documentElement.outerHTML;
      return "";
    },
    setHTML(html) {
      state.html = String(html ?? "");
      if (state.document && typeof state.document === "object") {
        state.document.__v16_html = state.html;
      }
      return state.html;
    },
    textIncludes(text) {
      const html = api.getHTML();
      return html.includes(String(text));
    },
    findByTag(tagName) {
      const html = api.getHTML();
      const tag = String(tagName).toLowerCase();
      const pattern = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi");
      const matches = [];
      let match = pattern.exec(html);
      while (match) {
        matches.push(match[0]);
        match = pattern.exec(html);
      }
      return matches;
    },
    replaceText(search, replace) {
      const html = api.getHTML();
      const pattern = new RegExp(escapeRegExp(String(search)), "g");
      const next = html.replace(pattern, String(replace));
      api.setHTML(next);
      return next;
    },
    appendHTML(fragment) {
      const next = `${api.getHTML()}${String(fragment)}`;
      api.setHTML(next);
      return next;
    }
  };

  return api;
}
