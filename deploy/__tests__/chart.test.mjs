/**
 * The Helm chart, rendered and checked without a cluster.
 *
 * kind (scripts/kind-smoke.sh) proves the chart installs and serves. These
 * cases prove what an install alone would not notice: that the defaults are
 * hardened rather than merely accepted, that a value someone sets actually
 * reaches the manifest, that a half-configured Ingress is refused at render
 * time instead of producing an Ingress with no host, and that nothing in the
 * chart names a host on its own.
 *
 * Values go in as JSON files, which Helm reads as YAML, so the tests need no
 * YAML library. What comes out is matched as text per rendered document; the
 * templates emit one key per line, which keeps that honest.
 *
 * Needs `helm` on PATH and fails rather than skips without it.
 *
 * Run with: npm run test:chart
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test, { after } from 'node:test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHART = join(ROOT, 'deploy', 'helm', 'atlas')
const temps = []

after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true })
})

function helm(args) {
  const run = spawnSync('helm', args, { encoding: 'utf-8' })
  if (run.error?.code === 'ENOENT') {
    throw new Error('helm is not on PATH. These tests render the chart and cannot run without it.')
  }
  return run
}

/** Render the chart with `values`; returns the run and its documents by kind. */
function render(values = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-chart-'))
  temps.push(dir)
  const file = join(dir, 'values.json')
  writeFileSync(file, JSON.stringify(values))
  const run = helm(['template', 'atlas', CHART, '--namespace', 'atlas', '-f', file])
  const docs = run.stdout
    .split(/^---$/m)
    .map((text) => text.trim())
    .filter((text) => /^kind: /m.test(text))
    .map((text) => ({ kind: text.match(/^kind: (\S+)/m)[1], text }))
  return { ...run, docs }
}

/** The one document of `kind`, failing if there is not exactly one. */
function one(rendered, kind) {
  assert.equal(rendered.status, 0, rendered.stderr)
  const found = rendered.docs.filter((d) => d.kind === kind)
  assert.equal(found.length, 1, `expected one ${kind}, rendered ${found.length}`)
  return found[0].text
}

const kinds = (rendered) => rendered.docs.map((d) => d.kind).sort()

test('helm lint passes on the defaults, strictly', () => {
  const run = helm(['lint', '--strict', CHART])
  assert.equal(run.status, 0, run.stdout + run.stderr)
})

test('the defaults render the workload and nothing that needs a cluster decision', () => {
  // Ingress and HTTPRoute both depend on what the cluster runs, which is the
  // cloud platform team's call, so neither renders until a value asks for it.
  const rendered = render()
  assert.equal(rendered.status, 0, rendered.stderr)
  assert.deepEqual(kinds(rendered), [
    'Deployment',
    'NetworkPolicy',
    'Pod',
    'PodDisruptionBudget',
    'Service',
    'ServiceAccount',
  ])
})

test('the pod runs as uid 101, non-root, read-only, with every capability dropped', () => {
  const deployment = one(render(), 'Deployment')
  for (const line of [
    'runAsNonRoot: true',
    'runAsUser: 101',
    'runAsGroup: 101',
    'readOnlyRootFilesystem: true',
    'allowPrivilegeEscalation: false',
    'type: RuntimeDefault',
    'automountServiceAccountToken: false',
  ]) {
    assert.match(deployment, new RegExp(`^\\s+${line}$`, 'm'), `missing "${line}"`)
  }
  assert.match(deployment, /drop:\n\s+- ALL/)
})

test('the only writable path is an emptyDir at /tmp, where nginx keeps its pid and temp files', () => {
  const deployment = one(render(), 'Deployment')
  assert.match(deployment, /mountPath: \/tmp/)
  assert.match(deployment, /emptyDir:\n\s+medium: Memory\n\s+sizeLimit: \S+/)
  assert.equal((deployment.match(/mountPath:/g) ?? []).length, 1, 'more than one volume mount')
})

test('liveness, readiness and startup all probe the health endpoint', () => {
  const deployment = one(render(), 'Deployment')
  for (const probe of ['livenessProbe', 'readinessProbe', 'startupProbe']) {
    assert.match(
      deployment,
      new RegExp(`${probe}:\\n\\s+httpGet:\\n\\s+path: /healthz\\n\\s+port: http`),
      `${probe} does not GET /healthz on the http port`,
    )
  }
  assert.match(deployment, /containerPort: 8080/)
})

test('requests and limits are set by default, and values replace them', () => {
  const deployment = one(render(), 'Deployment')
  assert.match(deployment, /resources:\n\s+limits:\n\s+cpu: \S+\n\s+memory: \S+\n\s+requests:\n\s+cpu: \S+\n\s+memory: \S+/)

  // Helm deep-merges values over the defaults, so dropping the CPU limit (a
  // cluster that forbids them, say) takes an explicit null, not an omission.
  const tuned = one(
    render({ resources: { requests: { cpu: '5m', memory: '8Mi' }, limits: { cpu: null, memory: '48Mi' } } }),
    'Deployment',
  )
  assert.match(tuned, /requests:\n\s+cpu: 5m\n\s+memory: 8Mi/)
  assert.match(tuned, /limits:\n\s+memory: 48Mi\n\s+requests:/)
})

test('the image reference is built from values, with no registry until one is chosen', () => {
  // The registry is an open question for the cloud platform team, so the
  // default names no registry at all rather than guessing one.
  assert.match(one(render(), 'Deployment'), /image: "atlas:0\.1\.0"/)
  assert.match(
    one(render({ image: { registry: 'registry.example.test/ocean', tag: 'abc123' } }), 'Deployment'),
    /image: "registry\.example\.test\/ocean\/atlas:abc123"/,
  )
  const digest = `sha256:${'a'.repeat(64)}`
  assert.match(
    one(render({ image: { tag: 'abc123', digest } }), 'Deployment'),
    new RegExp(`image: "atlas@${digest}"`),
    'a digest must win over a tag, so a moved tag cannot change what runs',
  )
})

test('the Service fronts the http port and is cluster-internal by default', () => {
  const service = one(render(), 'Service')
  assert.match(service, /type: ClusterIP/)
  assert.match(service, /port: 80\n\s+targetPort: http/)
})

test('an Ingress takes its host, class and TLS secret from values', () => {
  const ingress = one(
    render({
      ingress: {
        enabled: true,
        className: 'shared',
        host: 'atlas.example.test',
        annotations: { 'example.test/owner': 'platform' },
        tls: { enabled: true, secretName: 'atlas-tls' },
      },
    }),
    'Ingress',
  )
  assert.match(ingress, /ingressClassName: shared/)
  assert.match(ingress, /example\.test\/owner: platform/)
  assert.match(ingress, /tls:\n\s+- hosts:\n\s+- "atlas\.example\.test"\n\s+secretName: atlas-tls/)
  assert.match(ingress, /- host: "atlas\.example\.test"/)
  assert.match(ingress, /path: \/\n\s+pathType: Prefix/)
  assert.match(ingress, /service:\n\s+name: atlas\n\s+port:\n\s+name: http/)
})

test('an Ingress without TLS has no tls block, and one without a class leaves it to the cluster default', () => {
  const ingress = one(render({ ingress: { enabled: true, host: 'atlas.example.test' } }), 'Ingress')
  assert.doesNotMatch(ingress, /^\s+tls:/m)
  assert.doesNotMatch(ingress, /ingressClassName/)
})

test('an Ingress with no host is refused at render time', () => {
  const run = render({ ingress: { enabled: true } })
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /ingress\.host/)
})

test('TLS with no secret name is refused at render time', () => {
  const run = render({ ingress: { enabled: true, host: 'atlas.example.test', tls: { enabled: true } } })
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /ingress\.tls\.secretName/)
})

test('a Gateway API route is available for a cluster that runs Gateway API instead', () => {
  const route = one(
    render({
      httpRoute: {
        enabled: true,
        hostnames: ['atlas.example.test'],
        parentRefs: [{ name: 'shared', namespace: 'gateways', sectionName: 'https' }],
      },
    }),
    'HTTPRoute',
  )
  assert.match(route, /apiVersion: gateway\.networking\.k8s\.io\/v1/)
  assert.match(route, /- "atlas\.example\.test"/)
  assert.match(route, /name: shared\n\s+namespace: gateways\n\s+sectionName: https/)
  assert.match(route, /backendRefs:\n\s+- name: atlas\n\s+port: 80/)
})

test('a route with no parent gateway is refused at render time', () => {
  const run = render({ httpRoute: { enabled: true, hostnames: ['atlas.example.test'] } })
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /httpRoute\.parentRefs/)
})

test('the NetworkPolicy denies all egress, which is what "no phone-home" means on the wire', () => {
  const policy = one(render(), 'NetworkPolicy')
  assert.match(policy, /policyTypes:\n\s+- Ingress\n\s+- Egress/)
  assert.match(policy, /egress: \[\]/)
  assert.match(policy, /port: http/)
})

test('ingress to the pod can be narrowed to the controller namespace', () => {
  const policy = one(
    render({
      networkPolicy: {
        ingressFrom: [{ namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'ingress' } } }],
      },
    }),
    'NetworkPolicy',
  )
  assert.match(policy, /namespaceSelector:\n\s+matchLabels:\n\s+kubernetes\.io\/metadata\.name: ingress/)
})

test('one replica gets no disruption budget, because minAvailable 1 would block every drain', () => {
  const rendered = render({ replicaCount: 1 })
  assert.equal(rendered.status, 0, rendered.stderr)
  assert.ok(!kinds(rendered).includes('PodDisruptionBudget'))
})

test('the chart test pod reuses the app image and passes the restricted pod standard', () => {
  // No second image to mirror into an air-gapped registry, and nothing that a
  // namespace enforcing the restricted Pod Security Standard would reject.
  const pod = one(render({ image: { tag: 'abc123' } }), 'Pod')
  assert.match(pod, /"helm\.sh\/hook": test/)
  assert.match(pod, /image: "atlas:abc123"/)
  assert.match(pod, /runAsNonRoot: true/)
  assert.match(pod, /readOnlyRootFilesystem: true/)
  assert.match(pod, /drop:\n\s+- ALL/)
  assert.match(pod, /\/healthz/)
  assert.match(pod, /\/network\?site=northgate/)
})

test('values the schema does not know are refused, so a typo cannot be silently ignored', () => {
  const run = render({ ingres: { enabled: true } })
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /ingres/)
})

test('nothing in the chart names a host of its own', () => {
  // The host is a value. A default that names the Pages domain, or a client's,
  // is a deployment that lands somewhere nobody chose.
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name)
      return statSync(full).isDirectory() ? walk(full) : [full]
    })
  for (const file of walk(CHART)) {
    const text = readFileSync(file, 'utf-8')
    assert.doesNotMatch(text, /oceansllc|analyticadss|github\.io/i, `${file} names a host`)
  }
})
