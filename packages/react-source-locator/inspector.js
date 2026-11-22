// Saycode element pick inspector (Desktop specs/element-pick-source-inspector R9).
// Desktop runs this file as ONE function expression, inside the page, for the element the user just picked:
// `(element) => Promise<{ componentName?, file?, line?, column? } | null>`. Keep it self-contained — no imports,
// no top-level statements — and answer null when the page is not a React development build.
(async (element) => {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  // Frames inside React or a bundler's prebundled deps are never where the user wrote the element.
  const LIBRARY_FRAME = /node_modules|\/\.vite\/deps\/|react-dom|react_jsx|jsx-dev-runtime|react\.development|react-server-dom/

  const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'))
  if (!fiberKey) return null
  const fiber = element[fiberKey]

  const typeName = (type) => {
    if (!type || typeof type === 'string') return undefined
    return type.displayName || type.name || type.render?.displayName || type.render?.name || type.type?.displayName || type.type?.name || undefined
  }
  const componentName = () => {
    const owner = fiber._debugOwner
    const fromOwner = owner && (typeof owner.name === 'string' ? owner.name : typeName(owner.type))
    if (fromOwner) return fromOwner
    for (let node = fiber.return; node; node = node.return) {
      const name = typeName(node.type)
      if (name) return name
    }
    return undefined
  }

  const decodeSegment = (segment) => {
    const values = []
    let value = 0, shift = 0
    for (const char of segment) {
      const digit = B64.indexOf(char)
      if (digit < 0) return null
      value += (digit & 31) << shift
      if (digit & 32) { shift += 5; continue }
      values.push(value & 1 ? -(value >>> 1) : value >>> 1)
      value = 0; shift = 0
    }
    return values
  }
  // Generated (line, column), both 1-based → the last original position at or before it.
  const lookup = (map, line, column) => {
    if (typeof map?.mappings !== 'string' || !Array.isArray(map.sources)) return null
    const lines = map.mappings.split(';')
    let source = 0, originalLine = 0, originalColumn = 0, best = null
    for (let index = 0; index < lines.length && index < line; index += 1) {
      let generatedColumn = 0
      for (const segment of lines[index].split(',')) {
        if (!segment) continue
        const values = decodeSegment(segment)
        if (!values) return null
        generatedColumn += values[0]
        if (values.length < 4) continue
        source += values[1]; originalLine += values[2]; originalColumn += values[3]
        if (index === line - 1 && generatedColumn <= column - 1) best = { source, originalLine, originalColumn }
      }
    }
    if (!best || typeof map.sources[best.source] !== 'string') return null
    return { source: map.sources[best.source], line: best.originalLine + 1, column: best.originalColumn + 1, root: map.sourceRoot }
  }
  const cleanPath = (path) => path.replace(/^webpack:\/\/[^/]*\//, '').replace(/^(?:\.\/)+/, '').replace(/^\/+(?=src\/|app\/|pages\/|components\/)/, '')
  const servedPath = (url) => cleanPath(new URL(url).pathname.replace(/^\//, ''))
  const readMap = async (scriptUrl) => {
    const code = await (await fetch(scriptUrl)).text()
    const reference = [...code.matchAll(/[#@] sourceMappingURL=(\S+)/g)].at(-1)?.[1]
    if (!reference) return null
    const inline = /^data:application\/json[^,]*;base64,(.*)$/.exec(reference)
    if (inline) return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(inline[1]), (char) => char.charCodeAt(0))))
    return (await fetch(new URL(reference, scriptUrl))).json()
  }
  const fromStack = async (stack) => {
    for (const line of String(stack).split('\n').slice(1)) {
      const match = /at (?:.+? \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line.trim())
      if (!match || LIBRARY_FRAME.test(match[1]) || !/^https?:/.test(match[1])) continue
      const [, url, lineText, columnText] = match
      const generated = { file: servedPath(url), line: Number(lineText), column: Number(columnText) }
      try {
        const original = lookup(await readMap(url), generated.line, generated.column)
        if (!original) return generated
        const isUrlRelative = !/^(?:\/|[a-z]+:)/i.test(original.source) && !original.root
        const path = isUrlRelative ? new URL(original.source, url).pathname.replace(/^\//, '') : `${original.root ? `${original.root.replace(/\/$/, '')}/` : ''}${original.source}`
        return { file: cleanPath(path), line: original.line, column: original.column }
      } catch {
        return generated
      }
    }
    return null
  }

  let location = null
  const debugSource = fiber._debugSource
  if (debugSource && typeof debugSource.fileName === 'string') {
    location = { file: debugSource.fileName, line: debugSource.lineNumber, column: debugSource.columnNumber }
  } else if (fiber._debugStack) {
    location = await fromStack(fiber._debugStack.stack ?? fiber._debugStack)
  }
  const name = componentName()
  if (!location && !(name && fiber._debugOwner)) return null
  const result = {}
  if (name) result.componentName = name
  if (location) {
    result.file = location.file
    if (Number.isInteger(location.line)) result.line = location.line
    if (Number.isInteger(location.line) && Number.isInteger(location.column)) result.column = location.column
  }
  return result
})
