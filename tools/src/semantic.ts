/**
 * The `semantic` phase: rules JSON Schema cannot express.
 *
 * NON-NORMATIVE, like everything under tools/. The definitive rule for each
 * check below is the `spec.md` clause named in its comment; this file is one
 * adapter's reading of it, and where the two disagree the prose wins.
 *
 * The rules divide by what they need, and the division is the prose's, not this
 * runner's. An **in-document** rule is decided by reading the document. An
 * **item-scoped** rule is measured against the item root
 * ([blueprint §3.1](../../specifications/blueprint/v1/spec.md#item-directory)),
 * and a caller that supplies no item root MUST NOT have those rules reported:
 * "a diagnostic it cannot substantiate is worse than a silence."
 */
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { type Diagnostic, parseDocument } from './document.ts'
import { type Family, isObject, type Json } from './spec.ts'

export type { Diagnostic }

export interface SemanticContext {
  /**
   * Absolute path to the item root. Absent when the document did not arrive
   * with a directory — a payload submitted over an API, or an `examples/`
   * document. Item-scoped rules are silent without it.
   */
  readonly itemRoot?: string
  /**
   * Absolute path to the document under test. Repo-local component references
   * resolve relative to its directory (blueprint §4.1). Defaults to the item
   * root's conventional `blueprint.yaml` when omitted.
   */
  readonly documentPath?: string
}

/** Escape one JSON Pointer reference token (RFC 6901 §3). */
function token(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function child(value: Json | undefined, key: string): Json | undefined {
  return isObject(value) ? value[key] : undefined
}

function asString(value: Json | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Mapping keys in document order, or an empty list when the node is not one. */
function keysOf(value: Json | undefined): string[] {
  return isObject(value) ? Object.keys(value) : []
}

// ===========================================================================
// component
// ===========================================================================

/**
 * Component §5.1. Curated, and it will grow — which is exactly why it is here
 * and not in a `pattern`. Growing a pattern makes a previously valid document
 * invalid; growing this list is a minor release.
 */
const FLOATING_TAGS = new Set([
  'latest',
  'main',
  'main-stable',
  'master',
  'stable',
  'edge',
  'nightly',
  'dev',
  'rolling',
])

/**
 * Component §5.2 — the protocols whose `PUBLIC` form publishes a URL. A `TCP` or
 * `UDP` endpoint publishes a `host:port` address instead, which is why §5.4's
 * probes and §6.1's platform defaults may not resolve to one: a probe polls an
 * HTTP path, and both platform-default sources take their value from a URL.
 */
const HTTP_FAMILY = new Set(['HTTP', 'HTTPS', 'WS', 'GRPC'])

/**
 * The tag of an image reference, or `undefined` when it carries none.
 *
 * The tag colon is the one after the final slash. Without that rule
 * `localhost:5000/nginx` reads as an image named `localhost` tagged
 * `5000/nginx`, and a reference behind a ported registry is misjudged.
 */
function imageTag(ref: string): string | undefined {
  const afterSlash = ref.slice(ref.lastIndexOf('/') + 1)
  const colon = afterSlash.indexOf(':')
  return colon === -1 ? undefined : afterSlash.slice(colon + 1)
}

/** Component §5.1 — a reference MUST NOT carry a floating tag. */
function checkImageRef(document: Json, out: Diagnostic[]): void {
  const source = child(child(child(document, 'spec'), 'workload'), 'source')
  const ref = asString(child(source, 'ref'))
  if (ref === undefined || child(source, 'type') !== 'IMAGE') return

  // A digest is what resolves, so it satisfies the rule whatever tag it carries.
  if (ref.includes('@sha256:')) return

  const tag = imageTag(ref)
  if (tag !== undefined && FLOATING_TAGS.has(tag.toLowerCase())) {
    out.push({
      code: 'ERR_UNPINNED_IMAGE',
      path: '/spec/workload/source/ref',
      message: `tag "${tag}" floats; pin a digest or an immutable tag`,
    })
  }
}

/**
 * Component §5.2 — the endpoint a null reference selects. The sole endpoint
 * where the workload declares exactly one, failing that its sole PUBLIC one,
 * failing that nothing.
 *
 * §5.2 chose "nothing" over a sort-order tiebreak deliberately: a tiebreak
 * lets a new endpoint named `api` silently re-point a probe that already works.
 */
function primaryEndpoint(endpoints: Json | undefined): string | undefined {
  const names = keysOf(endpoints)
  if (names.length === 1) return names[0]

  const publicNames = names.filter(
    (name) => child(child(endpoints, name), 'visibility') === 'PUBLIC',
  )
  return publicNames.length === 1 ? publicNames[0] : undefined
}

/**
 * One place a document names an endpoint: a probe's `endpoint` (§5.4) or a
 * platform default's (§6.1). `mustBePublic` is what separates them — both
 * platform-default sources derive an externally reachable address.
 */
interface EndpointReference {
  /** The raw value, so an explicit null and an absent key are one case. */
  readonly value: Json | undefined
  readonly path: string
  readonly subject: string
  readonly mustBePublic: boolean
}

/**
 * Component §5.2, §5.4 and §6.1. JSON Schema can express none of this: the
 * endpoint names are mapping keys elsewhere in the document, and no keyword
 * constrains a value against a sibling's keys.
 */
function checkEndpointReference(
  reference: EndpointReference,
  endpoints: Json | undefined,
  out: Diagnostic[],
): void {
  const named = asString(reference.value)

  // Absent or null both select the primary, which §5.2 may elect to be nothing.
  // Every rule below is measured against whichever endpoint the reference
  // resolves to, named or elected — §5.2 makes the primary what null *selects*,
  // so a rule about the endpoint a reference names reaches it equally.
  const selected = named ?? primaryEndpoint(endpoints)
  if (selected === undefined) {
    out.push({
      code: 'ERR_AMBIGUOUS_ENDPOINT',
      path: reference.path,
      message: `${reference.subject} names no endpoint, and the workload elects no primary`,
    })
    return
  }

  const declared = child(endpoints, selected)
  if (declared === undefined) {
    out.push({
      code: 'ERR_UNKNOWN_ENDPOINT',
      path: reference.path,
      message: `${reference.subject} targets endpoint "${selected}", which the workload does not declare`,
    })
    return
  }

  // §5.4 and §6.1 — a probe polls an HTTP path and both platform-default
  // sources derive from a URL. A TCP or UDP endpoint publishes a host:port
  // address instead, and has neither to give.
  const protocol = asString(child(declared, 'protocol'))
  if (protocol !== undefined && !HTTP_FAMILY.has(protocol)) {
    out.push({
      code: 'ERR_ENDPOINT_NOT_HTTP',
      path: reference.path,
      message: `${reference.subject} resolves to endpoint "${selected}", which serves ${protocol}`,
    })
    return
  }

  if (reference.mustBePublic && child(declared, 'visibility') !== 'PUBLIC') {
    out.push({
      code: 'ERR_ENDPOINT_NOT_PUBLIC',
      path: reference.path,
      message: `${reference.subject} derives a public address from endpoint "${selected}", which is PRIVATE`,
    })
  }
}

/** Every endpoint a component document names, in document order. */
function endpointReferences(document: Json): EndpointReference[] {
  const spec = child(document, 'spec')
  const health = child(child(spec, 'workload'), 'health')
  const inputs = child(child(spec, 'contract'), 'inputs')
  const references: EndpointReference[] = []

  for (const probe of keysOf(health)) {
    references.push({
      value: child(child(health, probe), 'endpoint'),
      path: `/spec/workload/health/${token(probe)}/endpoint`,
      subject: `${probe} probe`,
      mustBePublic: false,
    })
  }

  for (const input of keysOf(inputs)) {
    const platformDefault = child(child(inputs, input), 'platformDefault')
    if (!isObject(platformDefault)) continue
    references.push({
      value: child(platformDefault, 'endpoint'),
      path: `/spec/contract/inputs/${token(input)}/platformDefault/endpoint`,
      subject: `platform default on input "${input}"`,
      mustBePublic: true,
    })
  }

  return references
}

function checkEndpointReferences(document: Json, out: Diagnostic[]): void {
  const endpoints = child(child(child(document, 'spec'), 'workload'), 'endpoints')
  for (const reference of endpointReferences(document)) {
    checkEndpointReference(reference, endpoints, out)
  }
}

/**
 * Component §5.3 — every environment-variable key is declared exactly once,
 * across both the places that declare one.
 *
 * `envVars` is a sequence rather than a mapping, so §5's "a repeated key is
 * ERR_DUPLICATE_KEY in the parser phase" does not reach it: two entries of a
 * sequence repeat nothing at the YAML level. An input's `target.envVarKey`
 * binds into the same namespace, so it competes with them.
 */
function checkEnvVarKeys(document: Json, out: Diagnostic[]): void {
  const spec = child(document, 'spec')
  const envVars = child(child(spec, 'workload'), 'envVars')
  const inputs = child(child(spec, 'contract'), 'inputs')

  // First declaration wins the key, so the later one is what an author changes.
  const declared = new Map<string, string>()

  if (Array.isArray(envVars)) {
    for (const [position, entry] of envVars.entries()) {
      const key = asString(child(entry, 'key'))
      if (key === undefined) continue
      const earlier = declared.get(key)
      if (earlier === undefined) {
        declared.set(key, `envVars entry ${position}`)
        continue
      }
      out.push({
        code: 'ERR_DUPLICATE_ENV_KEY',
        path: `/spec/workload/envVars/${position}/key`,
        message: `environment variable "${key}" is already declared by ${earlier}`,
      })
    }
  }

  // Lexicographic input-name order, because §5.3 anchors the collision at the
  // later of two inputs and a mapping supplies no order of its own.
  for (const input of keysOf(inputs).sort()) {
    const key = asString(child(child(child(inputs, input), 'target'), 'envVarKey'))
    if (key === undefined) continue
    const earlier = declared.get(key)
    if (earlier === undefined) {
      declared.set(key, `input "${input}"`)
      continue
    }
    out.push({
      code: 'ERR_CONFLICTING_ENV_KEY',
      path: `/spec/contract/inputs/${token(input)}/target/envVarKey`,
      message: `environment variable "${key}" is already claimed by ${earlier}`,
    })
  }
}

// ===========================================================================
// blueprint
// ===========================================================================

const LOCAL_REFERENCE = /^\.\.?\//

/** Consumer-anchored edges: node → the nodes it reads a value from. */
function connectionGraph(document: Json): Map<string, string[]> {
  const components = child(child(document, 'spec'), 'components')
  const graph = new Map<string, string[]>()
  for (const node of keysOf(components)) {
    const connections = child(child(components, node), 'connections')
    const targets: string[] = []
    for (const key of keysOf(connections)) {
      const from = asString(child(child(connections, key), 'fromRole'))
      if (from !== undefined) targets.push(from)
    }
    graph.set(node, targets)
  }
  return graph
}

/** Blueprint §4.2 — `fromRole` MUST name a node in this blueprint. */
function checkConnectionRoles(document: Json, out: Diagnostic[]): void {
  const components = child(child(document, 'spec'), 'components')
  const nodes = new Set(keysOf(components))
  for (const node of nodes) {
    const connections = child(child(components, node), 'connections')
    for (const key of keysOf(connections)) {
      const from = asString(child(child(connections, key), 'fromRole'))
      if (from !== undefined && !nodes.has(from)) {
        out.push({
          code: 'ERR_UNKNOWN_ROLE',
          path: `/spec/components/${token(node)}/connections/${token(key)}/fromRole`,
          message: `fromRole "${from}" names no node in this blueprint`,
        })
      }
    }
  }
}

/**
 * Blueprint §4.2 — the connection graph MUST be acyclic.
 *
 * Reporting is normative and pinned to a canonical form: the walk begins at the
 * lexicographically smallest node in the cycle. Two implementations that find
 * the same cycle then name it identically, instead of leaking whichever node
 * their traversal happened to start from into a comparable diagnostic.
 *
 * Cycles are found as strongly connected components, then reported one per
 * component. An SCC is the right granularity: a knot of four mutually reachable
 * nodes is one problem, not one per elementary cycle through it.
 */
function checkCycles(document: Json, out: Diagnostic[]): void {
  const graph = connectionGraph(document)
  const nodes = [...graph.keys()].sort()

  // Iterative Tarjan — a blueprint is small, but a recursive walk would put the
  // stack depth at the mercy of the document.
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const components: string[][] = []
  let counter = 0

  for (const root of nodes) {
    if (index.has(root)) continue
    const work: { node: string; next: number }[] = [{ node: root, next: 0 }]
    index.set(root, counter)
    low.set(root, counter)
    counter += 1
    stack.push(root)
    onStack.add(root)

    while (work.length > 0) {
      const frame = work[work.length - 1]
      if (frame === undefined) break
      const successors = (graph.get(frame.node) ?? []).filter((n) => graph.has(n)).sort()

      if (frame.next < successors.length) {
        const successor = successors[frame.next] as string
        frame.next += 1
        if (!index.has(successor)) {
          index.set(successor, counter)
          low.set(successor, counter)
          counter += 1
          stack.push(successor)
          onStack.add(successor)
          work.push({ node: successor, next: 0 })
        } else if (onStack.has(successor)) {
          low.set(frame.node, Math.min(low.get(frame.node) ?? 0, index.get(successor) ?? 0))
        }
        continue
      }

      work.pop()
      const parent = work[work.length - 1]
      if (parent !== undefined) {
        low.set(parent.node, Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0))
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = []
        for (;;) {
          const popped = stack.pop()
          if (popped === undefined) break
          onStack.delete(popped)
          component.push(popped)
          if (popped === frame.node) break
        }
        components.push(component)
      }
    }
  }

  for (const component of components) {
    const members = new Set(component)
    const selfLoop =
      component.length === 1 &&
      (graph.get(component[0] as string) ?? []).includes(component[0] as string)
    if (component.length < 2 && !selfLoop) continue

    const first = [...members].sort()[0] as string
    out.push({
      code: 'ERR_DEPENDENCY_CYCLE',
      path: `/spec/components/${token(first)}/connections`,
      message: `connection cycle: ${closedWalk(graph, members, first).join(' -> ')}`,
    })
  }
}

/**
 * A closed walk through `members` starting and ending at `first`, choosing the
 * lexicographically smallest unvisited successor at each step so the walk is a
 * property of the graph rather than of the traversal.
 */
function closedWalk(graph: Map<string, string[]>, members: Set<string>, first: string): string[] {
  const walk = [first]
  const seen = new Set([first])
  let current = first
  for (;;) {
    const successors = (graph.get(current) ?? []).filter((n) => members.has(n)).sort()
    if (successors.includes(first) && walk.length > 1) break
    const next = successors.find((n) => !seen.has(n))
    if (next === undefined) break
    seen.add(next)
    walk.push(next)
    current = next
  }
  walk.push(first)
  return walk
}

// ===========================================================================
// listing
// ===========================================================================

/**
 * Listing §5 — two screenshots MUST NOT share a basename, across the whole item
 * rather than within a directory. Published assets are addressed by basename,
 * so `media/desktop/overview.png` and `media/mobile/overview.png` are one file.
 */
function checkScreenshotBasenames(document: Json, out: Diagnostic[]): void {
  const screenshots = child(child(document, 'spec'), 'screenshots')
  if (!Array.isArray(screenshots)) return

  const seen = new Map<string, number>()
  for (const [position, screenshot] of screenshots.entries()) {
    const file = asString(child(screenshot, 'file'))
    if (file === undefined) continue
    const name = basename(file).toLowerCase()
    const earlier = seen.get(name)
    if (earlier === undefined) {
      seen.set(name, position)
      continue
    }
    // Reported at the later of the two: the first declaration is the one that
    // stands, so the second is the one an author has to change.
    out.push({
      code: 'ERR_DUPLICATE_MEDIA_BASENAME',
      path: `/spec/screenshots/${position}/file`,
      message: `basename "${basename(file)}" is already used by screenshot ${earlier}`,
    })
  }
}

// ===========================================================================
// item-scoped rules
// ===========================================================================

/** Every media path a listing declares, paired with its JSON Pointer. */
function mediaPaths(document: Json): { path: string; pointer: string }[] {
  const spec = child(document, 'spec')
  const found: { path: string; pointer: string }[] = []

  const icon = asString(child(spec, 'icon'))
  if (icon !== undefined) found.push({ path: icon, pointer: '/spec/icon' })

  const screenshots = child(spec, 'screenshots')
  if (Array.isArray(screenshots)) {
    for (const [position, screenshot] of screenshots.entries()) {
      const file = asString(child(screenshot, 'file'))
      if (file !== undefined) {
        found.push({ path: file, pointer: `/spec/screenshots/${position}/file` })
      }
    }
  }
  return found
}

/**
 * True when `target` lies strictly inside `root`. Both are expected to be
 * resolved already — this compares locations, and the caller is the one that
 * decides what resolution means.
 */
function contains(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * The resolved location of `path`, following symlinks. Containment is a
 * property of the resolved location rather than of the spelling — listing §5
 * and blueprint §4.1 both turn on that distinction.
 */
function resolveReal(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    // A dangling symlink still has a target, and a target outside the item root
    // is an escape whether or not anything is there. `readlinkSync` reads the
    // link itself, which `realpathSync` cannot once the chain is broken.
    try {
      return resolve(dirname(path), readlinkSync(path))
    } catch {
      // Not a link, or unreadable — the caller reports it as missing instead.
      return resolve(path)
    }
  }
}

/** Listing §5 — existence and containment, both of which need the filesystem. */
function checkMediaOnDisk(document: Json, itemRoot: string, out: Diagnostic[]): void {
  for (const { path, pointer } of mediaPaths(document)) {
    const target = join(itemRoot, path)
    if (!existsSync(target) && !isSymlink(target)) {
      out.push({
        code: 'ERR_MEDIA_NOT_FOUND',
        path: pointer,
        message: `${path} does not exist in the item`,
      })
      continue
    }
    if (!contains(itemRoot, resolveReal(target))) {
      out.push({
        code: 'ERR_PATH_ESCAPE',
        path: pointer,
        message: `${path} resolves outside the item root`,
      })
    }
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/** Every `*.yaml`/`*.yml` under `root`, recursively, as absolute paths. */
function yamlFiles(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.ya?ml$/i.test(entry.name)) found.push(path)
    }
  }
  walk(root)
  return found.sort()
}

const documentCache = new Map<string, Json | undefined>()

/** Parse a document off disk, or `undefined` when it is unreadable. */
function readDocument(path: string): Json | undefined {
  if (documentCache.has(path)) return documentCache.get(path)
  let parsed: Json | undefined
  try {
    const result = parseDocument(readFileSync(path, 'utf8'))
    parsed = 'value' in result ? result.value : undefined
  } catch {
    // Unreadable or malformed. The item's own parser-phase run reports that;
    // this one declines to describe a document it could not read.
    parsed = undefined
  }
  documentCache.set(path, parsed)
  return parsed
}

/**
 * Blueprint §3 and listing §3 — `metadata.slug` MUST equal the item directory
 * name, and `metadata.version` MUST equal the sibling document's.
 */
function checkIdentity(family: Family, document: Json, itemRoot: string, out: Diagnostic[]): void {
  const metadata = child(document, 'metadata')
  const slug = asString(child(metadata, 'slug'))
  const directory = basename(itemRoot)
  if (slug !== undefined && slug !== directory) {
    out.push({
      code: 'ERR_SLUG_MISMATCH',
      path: '/metadata/slug',
      message: `slug "${slug}" disagrees with the item directory "${directory}"`,
    })
  }

  // The sibling is the other half of the item. Listing §3 conditions the rule
  // on there being one: a `listingKind: COMPONENT` item need not hold a
  // blueprint, and where there is none the rule has nothing to compare.
  const siblingName = family.name === 'blueprint' ? 'listing.yaml' : 'blueprint.yaml'
  const siblingPath = join(itemRoot, siblingName)
  if (!existsSync(siblingPath)) return

  const sibling = readDocument(siblingPath)
  const version = child(metadata, 'version')
  const siblingVersion = child(child(sibling, 'metadata'), 'version')
  if (sibling !== undefined && version !== siblingVersion) {
    out.push({
      code: 'ERR_VERSION_MISMATCH',
      path: '/metadata/version',
      message: `version ${String(version)} disagrees with ${siblingName}'s ${String(siblingVersion)}`,
    })
  }
}

/**
 * Blueprint §4.1 and §4.2, plus §3's unreferenced-document rule and §5.2's
 * merge conflict. All four need the component documents the graph names, which
 * is what makes them item-scoped.
 */
function checkGraphAgainstItem(
  document: Json,
  itemRoot: string,
  documentPath: string,
  out: Diagnostic[],
): void {
  const components = child(child(document, 'spec'), 'components')
  const baseDir = dirname(documentPath)
  const referenced = new Set<string>()
  const resolved = new Map<string, Json>()

  for (const node of keysOf(components)) {
    const reference = asString(child(child(components, node), 'component'))
    const pointer = `/spec/components/${token(node)}/component`
    // A published reference is a UUID and belongs to the capability phase; only
    // the repo-local form resolves offline (§4.1).
    if (reference === undefined || !LOCAL_REFERENCE.test(reference)) continue

    const target = resolve(baseDir, reference)
    if (!contains(itemRoot, resolveReal(target))) {
      out.push({
        code: 'ERR_REFERENCE_ESCAPE',
        path: pointer,
        message: `${reference} resolves outside the item root`,
      })
      continue
    }
    if (!existsSync(target)) {
      out.push({
        code: 'ERR_COMPONENT_NOT_FOUND',
        path: pointer,
        message: `${reference} names no document`,
      })
      continue
    }
    referenced.add(realpathSync(target))
    const component = readDocument(target)
    if (component !== undefined) resolved.set(node, component)
  }

  checkUnreferencedComponents(itemRoot, documentPath, referenced, out)
  checkConnectionOutputs(components, resolved, out)
  checkConnectionCompatibility(components, resolved, out)
  checkInputMerge(components, resolved, out)
}

/** Blueprint §3 — every component document in the item MUST be referenced. */
function checkUnreferencedComponents(
  itemRoot: string,
  documentPath: string,
  referenced: Set<string>,
  out: Diagnostic[],
): void {
  const self = realpathSync(documentPath)
  for (const path of yamlFiles(itemRoot)) {
    const real = realpathSync(path)
    if (real === self || referenced.has(real)) continue
    if (child(readDocument(path), 'kind') !== 'COMPONENT') continue
    out.push({
      code: 'ERR_UNREFERENCED_COMPONENT',
      // Anchored at the mapping that should have named the file: a JSON Pointer
      // addresses this document, and the file it complains about is not in it.
      path: '/spec/components',
      message: `${relative(itemRoot, path)} is referenced by no node`,
    })
  }
}

/** Blueprint §4.2 — `fromOutput` MUST name an output the component declares. */
function checkConnectionOutputs(
  components: Json | undefined,
  resolved: Map<string, Json>,
  out: Diagnostic[],
): void {
  for (const node of keysOf(components)) {
    const connections = child(child(components, node), 'connections')
    for (const key of keysOf(connections)) {
      const connection = child(connections, key)
      const role = asString(child(connection, 'fromRole'))
      const output = asString(child(connection, 'fromOutput'))
      if (role === undefined || output === undefined) continue

      const producer = resolved.get(role)
      // An unresolved producer is already ERR_UNKNOWN_ROLE or
      // ERR_COMPONENT_NOT_FOUND; do not pile a second diagnostic on one cause.
      if (producer === undefined) continue

      const outputs = child(child(child(producer, 'spec'), 'contract'), 'outputs')
      if (!keysOf(outputs).includes(output)) {
        out.push({
          code: 'ERR_UNKNOWN_OUTPUT',
          path: `/spec/components/${token(node)}/connections/${token(key)}/fromOutput`,
          message: `"${output}" is not an output of the component "${role}" deploys`,
        })
      }
    }
  }
}

/**
 * Blueprint §4.2 — the two ends of a connection MUST fit.
 *
 * `type` is compared for equality with no widening in either direction; a
 * `semanticType` the consumer names must be matched exactly by the producer,
 * while a consumer naming none accepts anything. Both ends always carry a
 * `schema` with a required `type`, so there is no unconstrained producer case.
 */
function checkConnectionCompatibility(
  components: Json | undefined,
  resolved: Map<string, Json>,
  out: Diagnostic[],
): void {
  for (const node of keysOf(components)) {
    const connections = child(child(components, node), 'connections')
    const consumer = resolved.get(node)
    if (consumer === undefined) continue

    for (const key of keysOf(connections)) {
      const connection = child(connections, key)
      const role = asString(child(connection, 'fromRole'))
      const output = asString(child(connection, 'fromOutput'))
      if (role === undefined || output === undefined) continue

      const producer = resolved.get(role)
      if (producer === undefined) continue

      // A dangling end is already ERR_UNKNOWN_OUTPUT or ERR_UNKNOWN_INPUT; do
      // not pile a compatibility verdict on a pair that does not both exist.
      const outputs = child(child(child(producer, 'spec'), 'contract'), 'outputs')
      const inputs = child(child(child(consumer, 'spec'), 'contract'), 'inputs')
      const from = child(child(outputs, output), 'schema')
      const to = child(child(inputs, key), 'schema')
      if (from === undefined || to === undefined) continue

      const path = `/spec/components/${token(node)}/connections/${token(key)}/fromOutput`
      const fromType = child(from, 'type')
      const toType = child(to, 'type')
      if (fromType !== toType) {
        out.push({
          code: 'ERR_INCOMPATIBLE_TYPE',
          path,
          message: `output "${output}" is ${String(fromType)}, and input "${key}" takes ${String(toType)}`,
        })
        continue
      }

      // A consumer naming no semanticType has said the value is not specific to
      // a backing service, so nothing it receives can contradict that.
      const toSemantic = asString(child(to, 'semanticType'))
      if (toSemantic === undefined) continue
      const fromSemantic = asString(child(from, 'semanticType'))
      if (fromSemantic !== toSemantic) {
        out.push({
          code: 'ERR_INCOMPATIBLE_SEMANTIC_TYPE',
          path,
          message: `input "${key}" requires ${toSemantic}, and output "${output}" declares ${fromSemantic ?? 'none'}`,
        })
      }
    }
  }
}

/**
 * Blueprint §5.2 — first-wins in lexicographic node-name order, and a *differing*
 * redeclaration is an error rather than a silent discard. An identical one is
 * absorbed: two components that agree on what `adminPassword` is are not in
 * conflict.
 *
 * `ui` and `isRequired` are deliberately not compared. They describe how a value
 * is asked for, not what it is.
 */
function checkInputMerge(
  components: Json | undefined,
  resolved: Map<string, Json>,
  out: Diagnostic[],
): void {
  const taken = new Map<string, { node: string; schema: string }>()

  for (const node of keysOf(components).sort()) {
    const component = resolved.get(node)
    if (component === undefined) continue
    const inputs = child(child(child(component, 'spec'), 'contract'), 'inputs')

    for (const key of keysOf(inputs)) {
      const input = child(inputs, key)
      // A CONNECTION input is satisfied by a wire, never by the install form,
      // so it never reaches the merge (§5.1).
      if (child(input, 'suppliedBy') === 'CONNECTION') continue

      const schema = JSON.stringify(child(input, 'schema') ?? null)
      const earlier = taken.get(key)
      if (earlier === undefined) {
        taken.set(key, { node, schema })
        continue
      }
      if (earlier.schema === schema) continue
      out.push({
        code: 'ERR_CONFLICTING_INPUT_SCHEMA',
        path: `/spec/components/${token(node)}/component`,
        message: `input "${key}" is declared with a different schema by node "${earlier.node}"`,
      })
    }
  }
}

// ===========================================================================
// entry point
// ===========================================================================

/**
 * Every semantic diagnostic one document produces. Ordering within the result is
 * not normative — the conformance contract is that a declared diagnostic is
 * among those produced, not that it is produced first.
 */
export function semanticDiagnostics(
  family: Family,
  document: Json,
  context: SemanticContext = {},
): Diagnostic[] {
  const out: Diagnostic[] = []

  if (family.name === 'component') {
    checkImageRef(document, out)
    checkEndpointReferences(document, out)
    checkEnvVarKeys(document, out)
  }
  if (family.name === 'blueprint') {
    checkConnectionRoles(document, out)
    checkCycles(document, out)
  }
  if (family.name === 'listing') {
    checkScreenshotBasenames(document, out)
  }

  const { itemRoot } = context
  if (itemRoot === undefined) return out

  const documentPath =
    context.documentPath ??
    join(itemRoot, family.name === 'blueprint' ? 'blueprint.yaml' : 'listing.yaml')

  if (family.name === 'blueprint' || family.name === 'listing') {
    checkIdentity(family, document, itemRoot, out)
  }
  if (family.name === 'blueprint') {
    checkGraphAgainstItem(document, itemRoot, documentPath, out)
  }
  if (family.name === 'listing') {
    checkMediaOnDisk(document, itemRoot, out)
  }

  return out
}
