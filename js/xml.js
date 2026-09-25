// Small DOM helpers standing in for the E4X expressions used by the
// original ActionScript.

export function parseXML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('XML parse error: ' + err.textContent);
  return doc;
}

export function xmlAttr(el, name) {
  if (el == null || !el.hasAttribute(name)) return null;
  return el.getAttribute(name);
}

export function xmlHas(el, name) { return el != null && el.hasAttribute(name); }

export function xmlChildren(el, tag) {
  const out = [];
  if (el == null) return out;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (tag == null || c.tagName === tag) out.push(c);
  return out;
}

export function xmlFind(el, tag) {
  if (el == null) return null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.tagName === tag) return c;
  return null;
}

export function xmlChildByAttr(el, tag, attr, value) {
  for (const c of xmlChildren(el, tag)) if (c.getAttribute(attr) === value) return c;
  return null;
}
