function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeClassList(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((v) => String(v))));
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [String(value)];
}

function normalizeAirDom(input) {
  if (!input) return null;

  let value = input;
  if (typeof input === "string") {
    value = JSON.parse(input);
  }

  if (!value || typeof value !== "object") {
    throw new Error("AirDOM must be an object.");
  }

  const dom = deepClone(value);
  dom.version = String(dom.version ?? "air-jsobj/1");
  dom.root = Number(dom.root ?? 0);
  dom.nodes = Array.isArray(dom.nodes) ? dom.nodes : [];

  for (let i = 0; i < dom.nodes.length; i += 1) {
    const node = dom.nodes[i];
    node.index = Number(node.index ?? i);
    node.tag = String(node.tag ?? "div");
    node.parent = node.parent === null || node.parent === undefined ? null : Number(node.parent);
    node.child = Array.isArray(node.child) ? node.child.map((v) => Number(v)) : [];
    node.id = node.id === null || node.id === undefined ? null : String(node.id);
    node.class = normalizeClassList(node.class);
  }

  return dom;
}

function buildIndexMap(dom) {
  const map = new Map();
  for (const node of dom.nodes) {
    map.set(node.index, node);
  }
  return map;
}

export function createV16AirAPI(airDomLike = null) {
  const state = {
    dom: normalizeAirDom(airDomLike)
  };

  function requireDom() {
    if (!state.dom) {
      throw new Error("AirDOM is not bound.");
    }
    return state.dom;
  }

  function findNode(index) {
    const dom = requireDom();
    const map = buildIndexMap(dom);
    const key = Number(index);
    return map.get(key) ?? null;
  }

  const api = {
    bind(nextAirDom) {
      state.dom = normalizeAirDom(nextAirDom);
      return api;
    },
    hasAir() {
      return !!state.dom;
    },
    getVersion() {
      const dom = requireDom();
      return dom.version;
    },
    getRootIndex() {
      const dom = requireDom();
      return dom.root;
    },
    getNode(index) {
      const node = findNode(index);
      return node ? deepClone(node) : null;
    },
    getByTag(tagName) {
      const dom = requireDom();
      const tag = String(tagName).toLowerCase();
      return dom.nodes
        .filter((node) => node.tag.toLowerCase() === tag)
        .map((node) => deepClone(node));
    },
    getById(idValue) {
      const dom = requireDom();
      const id = String(idValue);
      const node = dom.nodes.find((entry) => entry.id === id);
      return node ? deepClone(node) : null;
    },
    childrenOf(index) {
      const node = findNode(index);
      if (!node) return [];
      const dom = requireDom();
      const map = buildIndexMap(dom);
      return node.child
        .map((childIndex) => map.get(childIndex))
        .filter(Boolean)
        .map((entry) => deepClone(entry));
    },
    parentOf(index) {
      const node = findNode(index);
      if (!node || node.parent === null) return null;
      return api.getNode(node.parent);
    },
    setId(index, nextId) {
      const node = findNode(index);
      if (!node) return false;
      node.id = nextId === null || nextId === undefined ? null : String(nextId);
      return true;
    },
    addClass(index, className) {
      const node = findNode(index);
      if (!node) return false;
      const name = String(className);
      if (!node.class.includes(name)) {
        node.class.push(name);
      }
      return true;
    },
    removeClass(index, className) {
      const node = findNode(index);
      if (!node) return false;
      const name = String(className);
      node.class = node.class.filter((entry) => entry !== name);
      return true;
    },
    hasClass(index, className) {
      const node = findNode(index);
      if (!node) return false;
      return node.class.includes(String(className));
    },
    renameTag(index, nextTag) {
      const node = findNode(index);
      if (!node) return false;
      node.tag = String(nextTag);
      return true;
    },
    toJSON() {
      const dom = requireDom();
      return deepClone(dom);
    },
    serialize() {
      const dom = requireDom();
      return JSON.stringify(dom, null, 2);
    }
  };

  return api;
}
