# Running ATLAS on Kubernetes

ATLAS is going to run as a container on Ocean's Kubernetes cluster, in Ocean's
commercial AWS account (Phase 7 of the technical plan). The cloud platform team is still
standing that cluster up. This page covers what the repository provides so the first
deploy needs nothing from the ATLAS side, what the cluster has to provide, and what is
still undecided.

Two things this work does not change:

- **The GitHub Pages deploy.** It still builds and publishes on every green `main`, and
  `atlas.oceansllc.com` (and the `atlas.analyticadss.com` mirror) still point at it. When
  the domain moves to the cluster, and whether Pages stays on as a fallback, is an open
  question (see the end of this page). None of the files here touch Pages, the custom
  domain, Cloudflare or DNS.
- **What the app is.** It is still static files that run in the browser. The container
  is a web server for those files and nothing else: no backend, no database, no secrets,
  no volumes. An analyst's own matrix is parsed in their tab and never reaches the server.

## What is in the image

| | |
|---|---|
| Contents | The built app (`npm run build:dist`) and the **invented sample bundle**, seeded from `fixtures/synthetic` inside the build |
| Server | `nginxinc/nginx-unprivileged` 1.30.6 on Alpine 3.24, pinned by digest, with our own [`deploy/nginx/nginx.conf`](../deploy/nginx/nginx.conf). The unused dynamic modules (geoip, image-filter, njs, xslt), their libraries and `curl` are removed, and the rest gets Alpine's security updates at build time, because upstream's rebuilds lag them. That leaves about 20 packages |
| User | uid/gid 101, never root. Listens on 8080 |
| Filesystem | Works with a read-only root. The only path it writes is `/tmp` (nginx's pid and temp files) |
| Configuration | **None.** The image reads no environment variables. Everything that varies between deployments is a chart value |
| Outbound traffic | None. No proxy, no resolver, no upstream; the chart's NetworkPolicy denies all egress on top of that |
| Identity | Built with the commit SHA as its build id: in the page's `<meta name="atlas-build">`, in the `org.opencontainers.image.revision` label, and as the CI tag |

**The image can never carry a real bundle.** The build context is an allowlist
([`.dockerignore`](../.dockerignore)) that excludes `public/data`, where the README tells an
analyst to build the real one. The bundle is seeded from `fixtures/synthetic` inside the
build, and [`scripts/check-image-data.mjs`](../scripts/check-image-data.mjs) fails the
build unless the image's `data/` matches the sample byte for byte. CI then copies the web
root out of the finished image and runs the same check again, after planting a fake real
bundle, a workbook and `.env` files in the checkout to show none of them get in
(technical plan, risk 12). Images are built in CI, not on laptops.

## What the server answers

| Request | Answer | `Cache-Control` |
|---|---|---|
| `/healthz` | `200 ok` | `no-store` |
| `/`, `/index.html` | the application document | `no-cache` |
| any view: `/network?site=…`, `/map#…`, `/lossiness`, `/nonsense` | the application document, **200**, at the URL asked for, no redirect | `no-cache` |
| `/assets/*` (hashed names) | the file, or a real 404 | `public, max-age=31536000, immutable` |
| `/data/*` (the sample bundle) | the file, or a real 404 | `no-cache` |
| a directory (`/data/`) | never a listing | |

Every response also carries `Content-Security-Policy: frame-ancestors 'none'`,
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`
and a `Permissions-Policy` that turns off camera, microphone, geolocation, payment and
USB. These are the headers GitHub Pages does not let us set. The page's own CSP stays in
its `<meta>` tag and still governs scripts, styles and connections. There is no HSTS
header: TLS ends at the ingress, so HSTS belongs there.

Access logs are JSON lines on stdout: time, method, path, status, bytes, duration. The
path is logged **without its query string**, and there is no client address or user
agent. A view's query names the site and devices a reader was looking at, and the hosted
app promises that nothing a user does is kept. The ingress controller's own logs are up
to the platform.

### One deliberate difference from GitHub Pages

Pages answers a deep link with `404.html` (a byte copy of `index.html`) and a **404**
status, because a static host cannot tell a view from a missing file. The container can,
so it answers with the same document and a **200**. Everything that matters to a reader
is the same: the same document, at the same URL, with the query and hash left alone. The
status differs for two reasons. An ingress controller set up with custom error pages
would replace a 404 body with its own page and break every shared link. And a monitor
counting 404s would count every bookmark. Missing assets and data files still get a real
404, which Pages cannot give either.

`e2e/deep-link.spec.ts` proves the Pages behaviour; `e2e/container.spec.ts` and
[`scripts/smoke-http.mjs`](../scripts/smoke-http.mjs) prove this one.

## Build and run it locally

```bash
docker build --build-arg ATLAS_BUILD_ID="$(git rev-parse HEAD)" -t atlas:dev .
```

```bash
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges -p 8080:8080 atlas:dev
```

```bash
node scripts/smoke-http.mjs http://127.0.0.1:8080 --build "$(git rev-parse HEAD)"
```

The smoke script checks everything in the table above from a client, and exits non-zero
naming each failed check. It is the same script CI and the kind test run, and it can be
pointed at the real cluster's URL once there is one.

## Smoke test in a throwaway cluster

```bash
scripts/kind-smoke.sh
```

This needs `docker`, `kind`, `helm`, `kubectl`, `node` and `openssl` (`brew install kind
helm` on a Mac). It builds the image, creates a kind cluster, loads the image straight
into it (no registry), and then checks that:

1. the chart lints, and installs with `--wait` into a namespace that **enforces the
   restricted Pod Security Standard**, with an Ingress and a TLS secret
2. both replicas come up, running as uid 101, and writes to the web root and `/etc` are
   refused
3. the pod cannot reach anything, the API server included (kind's CNI enforces
   NetworkPolicy)
4. `helm test` passes from inside the cluster
5. `scripts/smoke-http.mjs` passes through a port-forward, with the right build id

Then it deletes the cluster. `--keep` leaves it running, `--browser` also runs
`e2e/container.spec.ts` against it, and `--gateway-api` installs the Gateway API CRDs and
checks that the API server accepts the chart's HTTPRoute. An existing cluster named
`$KIND_CLUSTER` (default `atlas-smoke`) is reused, and `ATLAS_IMAGE` skips the build.

## Deploy with Helm

The chart is [`deploy/helm/atlas`](../deploy/helm/atlas). Every setting is a value. Nothing
in it names a host, and `values.schema.json` rejects keys it does not know, so a typo
fails the install instead of being ignored.

```bash
helm upgrade --install atlas deploy/helm/atlas \
  --namespace atlas --create-namespace \
  --set image.registry=REGISTRY \
  --set image.tag=COMMIT_SHA \
  --set ingress.enabled=true \
  --set ingress.className=INGRESS_CLASS \
  --set ingress.host=HOST \
  --set ingress.tls.enabled=true \
  --set ingress.tls.secretName=TLS_SECRET
```

```bash
helm test atlas --namespace atlas
```

| Value | Default | What it is for |
|---|---|---|
| `image.registry` / `image.repository` | `""` / `atlas` | Where the image lives. The registry is an open question |
| `image.tag` / `image.digest` | appVersion / `""` | The commit SHA CI tagged. A digest, if set, wins, so a moved tag cannot change what runs |
| `replicaCount` | `2` | Two, so a rolling update or a node drain leaves one serving. A PodDisruptionBudget keeps one up |
| `resources` | 10m / 16Mi requests, 200m / 64Mi limits | Idle use is a few MiB. Set a limit to `null` to drop it |
| `ingress.*` | off | `host` is required when enabled. `tls.secretName` names a Secret the cluster provides; the chart never creates certificates |
| `httpRoute.*` | off | The Gateway API alternative: `parentRefs` names the platform's Gateway, and TLS lives on its listener |
| `networkPolicy.enabled` | on | Denies all egress. `networkPolicy.ingressFrom` narrows ingress, e.g. to the controller's namespace |
| `podSecurityContext`, `securityContext` | uid 101, non-root, read-only root, no capabilities, RuntimeDefault seccomp | Passes the restricted Pod Security Standard as shipped |

The `helm test` pod runs the ATLAS image itself (Alpine's `wget`), so an air-gapped
registry needs only the one image mirrored.

## CI

[`.github/workflows/image.yml`](../.github/workflows/image.yml) runs on every push and pull
request. It is separate from `ci.yml` on purpose: `deploy.yml` publishes Pages only after
the workflow named `CI` succeeds, and a Docker Hub hiccup or a slow kind cluster must not
hold up the site.

- **chart**: chart and container tests under Helm 3 and Helm 4.
- **image**: plants decoys, builds the image (no push), checks the finished image's web root
  (sample data byte for byte, no remote asset references, no decoys), checks it runs as
  101 and names its commit, runs it with a read-only root and no capabilities, runs
  the HTTP smoke and the browser smoke, writes the SBOMs, scans them, and saves the image
  as a workflow artifact.
- **kind**: loads that exact image into a kind cluster and runs `scripts/kind-smoke.sh
  --gateway-api`.

**SBOMs** (artifact `atlas-sbom`, SPDX and CycloneDX JSON, made with syft): `atlas-image`
lists the Alpine and nginx packages in the image; `atlas-app` lists the npm dependencies
from `package-lock.json`. Both are needed, because the app's libraries are bundled into
`/assets` and leave nothing an image scanner can see.

**Vulnerability scan** (grype, over both SBOMs): the full report is in the artifact, and
the job fails on a *critical* finding that has a fix available, since that is one somebody
can act on by bumping a pin. Whether the gate should be stricter is an open question.

**No push yet.** When the registry is chosen, the push is one step at the end of the
`image` job: on push to `main` only, with credentials from GitHub's OIDC token rather than
a stored key, tagging the image with the commit SHA it already carries.

## What the cluster needs to provide

Proposed split, to confirm with the cloud platform team. The repository owns what ATLAS
is; the cluster owns where it runs.

| The cluster provides | So that | ATLAS side today |
|---|---|---|
| A container registry, pull access for the cluster, and a push credential for CI (OIDC, not a stored key) | CI can publish the image on green `main` | `image.registry` is a value; nothing is pushed |
| An ingress path: an IngressClass, or a Gateway with a listener for the host | Traffic reaches the Service | `ingress.*` and `httpRoute.*`, both off by default |
| A TLS certificate for the host: a Secret in the namespace (e.g. cert-manager) or terminated at the load balancer (e.g. ACM on an ALB) | HTTPS | `ingress.tls.secretName`; with load-balancer TLS, leave `tls.enabled` off and set the controller's annotations |
| DNS for the hostname | People can find it | Unchanged. `atlas.oceansllc.com` stays on GitHub Pages until the cutover is decided |
| A namespace and quota: two pods at 10m CPU / 16Mi requested, 200m / 64Mi limit | Scheduling | Passes `restricted` Pod Security as shipped |
| NetworkPolicy enforcement in the CNI, and the label of the controller's namespace | Egress denial is real, and ingress can be narrowed | Policy on by default; works without enforcement, just unenforced |
| Log collection from stdout | Operations | JSON access logs, no query strings, no client data |

There is no metrics endpoint. `/healthz` is for the probes and an uptime check.

## Sign-in

ATLAS builds no login and never will: sign-in is a platform capability. When Ocean's
platform SSO (OIDC, against Entra ID) is ready, it goes in front of ATLAS at the ingress or
gateway, for example an auth proxy or the load balancer's own OIDC support. The container
does not change: it serves static files to whatever the ingress lets through. The kubelet
probes go straight to the pod, so `/healthz` keeps working behind SSO.

## Client environments later

The same image and the same chart are meant to deploy into a client's cluster with
nothing but different values: their registry, host, TLS secret and ingress class. Nothing
in the image phones home, there is one image to mirror for an air-gapped registry, and the
SBOMs ship with it. Users who can reach no cluster at all still get the offline
single-file build (`atlas.html`), as before.

## Open questions

For the cloud platform team unless marked otherwise.

1. **Registry.** ECR in Ocean's account, or something else? Who creates the repository,
   and are tags immutable?
2. **Ingress or Gateway API**, and which controller and class. The community ingress-nginx
   project has been retired, so this is likely Gateway API or the AWS Load Balancer
   Controller. The chart supports either.
3. **TLS.** A cert-manager Secret in the namespace, or ACM at the load balancer?
4. **DNS cutover** (Ocean leadership and the ATLAS team). When `atlas.oceansllc.com` moves
   from GitHub Pages to the cluster, and whether Pages stays up as a fallback. The
   `atlas.analyticadss.com` mirror depends on Pages either way.
5. **How deploys happen.** Helm from CI with cluster credentials, or GitOps (Argo CD or
   Flux) pulling the chart? If GitOps, where the chart is published (an OCI registry beside
   the image is the usual answer).
6. **Supply chain.** Should images be signed (e.g. cosign) and checked at admission? Should
   the scan gate fail on *high* as well as critical?
7. **Node architecture.** CI builds `linux/amd64`. The build stage already runs on the
   builder's own platform, so adding `linux/arm64` for Graviton nodes is one buildx flag.
8. **Namespace conventions**: name, quota, Pod Security level, and the labels that
   identify the ingress controller's namespace.
9. **Sign-in in front of a sample-only site** (Ocean leadership). The hosted instance only
   ever serves invented data. Does it sit behind SSO from day one, or stay open like the
   Pages site?
10. **Monitoring.** Are logs and an uptime check on `/healthz` enough, or does the platform
    expect metrics from every app?

## Files

| Path | What it is |
|---|---|
| `Dockerfile`, `.dockerignore` | The image and its allowlisted build context |
| `deploy/nginx/nginx.conf` | The whole nginx configuration |
| `deploy/helm/atlas/` | The chart |
| `deploy/__tests__/chart.test.mjs` | Chart rendering tests (`npm run test:chart`, needs `helm`) |
| `scripts/check-image-data.mjs` | The image's data guard (`npm run test:image-data`) |
| `scripts/smoke-http.mjs` | HTTP smoke against any running instance (`npm run smoke:http -- <url>`) |
| `scripts/kind-smoke.sh` | The throwaway-cluster test |
| `scripts/__tests__/container.test.mjs` | Drift checks on the container files (`npm run test:container`) |
| `playwright.container.config.ts`, `e2e/container.spec.ts` | The browser smoke against a running image |
| `.github/workflows/image.yml` | CI for all of the above |
