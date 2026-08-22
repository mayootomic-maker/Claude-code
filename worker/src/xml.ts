/**
 * A minimal XML reader.
 *
 * Workers have no `DOMParser`, and OJP responses are XML. This is a small
 * purpose-built parser rather than a dependency or a pile of regexes: the
 * responses are deeply nested (a departure sits five levels down) and regex
 * extraction across that depth silently matches the wrong element the moment
 * the shape shifts.
 *
 * Namespace prefixes are dropped on the way in. Real responses mix
 * `<StopPointName>` and `<siri:StopPointRef>` in the same element, and the
 * prefixes carry no meaning we act on.
 */

export type XmlNode = {
  /** Local name, namespace prefix stripped. */
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  /** Direct text content, trimmed. Empty for container elements. */
  text: string
}

const EMPTY: XmlNode = { name: '', attrs: {}, children: [], text: '' }

/** Entities that actually appear in OJP output. */
function decodeEntities(input: string): string {
  if (!input.includes('&')) return input
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    // Ampersand last, so a literal &amp;lt; does not become a tag.
    .replace(/&amp;/g, '&')
}

function localName(raw: string): string {
  const colon = raw.indexOf(':')
  return colon === -1 ? raw : raw.slice(colon + 1)
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([\w:.-]+)\s*=\s*"([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(raw)) !== null) {
    if (match[1] === undefined || match[2] === undefined) continue
    attrs[localName(match[1])] = decodeEntities(match[2])
  }
  return attrs
}

/**
 * Parses a document into a tree.
 *
 * Returns the root element. Prologs, comments and CDATA are skipped; OJP does
 * not use processing instructions beyond the XML declaration.
 */
export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]

  // Matches an element tag or a run of text between tags.
  const tagPattern = /<([!?/]?)([\w:.-]*)((?:"[^"]*"|[^>"])*?)(\/?)>|([^<]+)/g
  let match: RegExpExecArray | null

  while ((match = tagPattern.exec(source)) !== null) {
    const [, prefix, rawName, rawAttrs, selfClose, textRun] = match

    if (textRun !== undefined) {
      const text = decodeEntities(textRun).trim()
      if (text !== '') {
        const top = stack[stack.length - 1]
        if (top !== undefined) top.text = top.text === '' ? text : `${top.text}${text}`
      }
      continue
    }

    // Declarations, comments and doctype carry nothing we need.
    if (prefix === '!' || prefix === '?') continue

    if (prefix === '/') {
      // Never pop past the root, however malformed the input.
      if (stack.length > 1) stack.pop()
      continue
    }

    const node: XmlNode = {
      name: localName(rawName ?? ''),
      attrs: parseAttrs(rawAttrs ?? ''),
      children: [],
      text: '',
    }
    const parent = stack[stack.length - 1]
    if (parent !== undefined) parent.children.push(node)
    if (selfClose !== '/') stack.push(node)
  }

  return root.children[0] ?? EMPTY
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** Direct children with the given local name. */
export function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.name === name)
}

/** First direct child with the given local name, or null. */
export function child(node: XmlNode, name: string): XmlNode | null {
  return node.children.find((c) => c.name === name) ?? null
}

/** Follows a chain of direct children, e.g. `path(n, 'Service', 'Mode')`. */
export function path(node: XmlNode | null, ...names: string[]): XmlNode | null {
  let current = node
  for (const name of names) {
    if (current === null) return null
    current = child(current, name)
  }
  return current
}

/**
 * Text at a path, or null when any step is missing.
 *
 * Trims: the live API returns `secondClass ` with a trailing space in
 * `FareClass`, which would otherwise fail a straight comparison.
 */
export function textAt(node: XmlNode | null, ...names: string[]): string | null {
  const target = path(node, ...names)
  if (target === null) return null
  const value = target.text.trim()
  return value === '' ? null : value
}

/**
 * Every descendant with the given name, at any depth.
 *
 * Used for elements whose nesting varies between response shapes.
 */
export function descendants(node: XmlNode, name: string): XmlNode[] {
  const found: XmlNode[] = []
  const walk = (current: XmlNode): void => {
    for (const c of current.children) {
      if (c.name === name) found.push(c)
      walk(c)
    }
  }
  walk(node)
  return found
}
