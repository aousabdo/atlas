#!/usr/bin/env bash
# Install the chart into a throwaway kind cluster and prove it serves the sample.
#
# This is the "throwaway cluster" of the technical plan (risk 11): the image and
# the chart are tested here, before Ocean's cluster exists, and the same script
# runs in the Image workflow. What it proves, in order:
#
#   1. the chart lints, and installs with --wait into a namespace that ENFORCES
#      the restricted Pod Security Standard, with an Ingress and a TLS secret
#   2. both replicas are ready, running as uid 101 on a root filesystem mounted
#      read-only, unable to rewrite their own config, writing only /tmp
#   3. on a CNI that enforces NetworkPolicy (kind's does), the pod cannot open a
#      connection to anything, not even the API server, and it is the policy
#      that stops it: no phone-home, on the wire
#   4. `helm test` passes from inside the cluster
#   5. scripts/smoke-http.mjs passes through a port-forward to the Service,
#      including the build id the image was built with
#   6. with --gateway-api, the HTTPRoute the chart renders is accepted by an API
#      server that has the Gateway API CRDs
#   7. with --browser, e2e/container.spec.ts passes against the same Service
#
# Usage:
#   scripts/kind-smoke.sh [--gateway-api] [--browser] [--keep]
#
# Environment (all optional):
#   ATLAS_IMAGE     image to test, already built (default: build atlas:kind-<id>)
#   ATLAS_BUILD_ID  the build id that image carries (default: from git)
#   KIND_CLUSTER    cluster name (default atlas-smoke); reused if it exists
#   ATLAS_PORT      local port for the port-forward (default 18090)
#
# Needs docker, kind, helm, kubectl, node and openssl. See docs/kubernetes.md.
set -euo pipefail

cd "$(dirname "$0")/.."

GATEWAY_API=0
BROWSER=0
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --gateway-api) GATEWAY_API=1 ;;
    --browser) BROWSER=1 ;;
    --keep) KEEP=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

CLUSTER="${KIND_CLUSTER:-atlas-smoke}"
NAMESPACE=atlas
RELEASE=atlas
HOST=atlas.example.test
PORT="${ATLAS_PORT:-18090}"
GATEWAY_API_VERSION=v1.7.0

for tool in docker kind helm kubectl node openssl; do
  command -v "$tool" >/dev/null || { echo "kind-smoke: $tool is not on PATH" >&2; exit 2; }
done

step() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nKIND SMOKE FAILED: %s\n' "$*" >&2; exit 1; }

WORK="$(mktemp -d)"
FORWARD_PID=""
CREATED_CLUSTER=0
cleanup() {
  status=$?
  [ -n "$FORWARD_PID" ] && kill "$FORWARD_PID" 2>/dev/null || true
  if [ "$status" -ne 0 ]; then
    echo "--- state at failure ---" >&2
    kubectl --context "kind-$CLUSTER" -n "$NAMESPACE" get all,ingress,networkpolicy 2>&1 >&2 || true
    kubectl --context "kind-$CLUSTER" -n "$NAMESPACE" describe pods 2>&1 | tail -40 >&2 || true
    kubectl --context "kind-$CLUSTER" -n "$NAMESPACE" logs -l app.kubernetes.io/name=atlas --tail 20 2>&1 >&2 || true
  fi
  if [ "$CREATED_CLUSTER" -eq 1 ] && [ "$KEEP" -eq 0 ]; then
    kind delete cluster --name "$CLUSTER" >/dev/null 2>&1 || true
  elif [ "$KEEP" -eq 1 ]; then
    echo "Kept cluster $CLUSTER. Remove it with: kind delete cluster --name $CLUSTER"
  fi
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

# --- image -------------------------------------------------------------------

if [ -z "${ATLAS_BUILD_ID:-}" ]; then
  ATLAS_BUILD_ID="$(git rev-parse HEAD)"
  # A build from a dirty tree is not the commit it names, so say so in the id.
  git diff --quiet HEAD -- 2>/dev/null || ATLAS_BUILD_ID="${ATLAS_BUILD_ID}-dirty"
fi
if [ -z "${ATLAS_IMAGE:-}" ]; then
  step "Building the image (build id $ATLAS_BUILD_ID)"
  docker build --build-arg ATLAS_BUILD_ID="$ATLAS_BUILD_ID" -t atlas:kind-build .
  # Tagged by content, so a rebuilt image gets a new tag and a reused cluster
  # rolls to it. The same tag over new bytes would leave the old pods running.
  image_id="$(docker image inspect atlas:kind-build --format '{{.Id}}' | sed 's/^sha256://' | cut -c1-12)"
  ATLAS_IMAGE="atlas:kind-$image_id"
  docker tag atlas:kind-build "$ATLAS_IMAGE"
fi
REPOSITORY="${ATLAS_IMAGE%:*}"
TAG="${ATLAS_IMAGE##*:}"

# --- cluster -----------------------------------------------------------------

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  step "Reusing kind cluster $CLUSTER"
else
  step "Creating kind cluster $CLUSTER"
  kind create cluster --name "$CLUSTER" --wait 120s
  CREATED_CLUSTER=1
fi
KUBECTL=(kubectl --context "kind-$CLUSTER")
HELM=(helm --kube-context "kind-$CLUSTER")

step "Loading $ATLAS_IMAGE into the cluster (no registry involved)"
kind load docker-image "$ATLAS_IMAGE" --name "$CLUSTER"

step "Namespace $NAMESPACE, enforcing the restricted Pod Security Standard"
"${KUBECTL[@]}" create namespace "$NAMESPACE" --dry-run=client -o yaml | "${KUBECTL[@]}" apply -f -
"${KUBECTL[@]}" label namespace "$NAMESPACE" --overwrite \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted

step "TLS secret for $HOST (self-signed; on the real cluster this comes from the platform)"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$HOST" \
  -keyout "$WORK/tls.key" -out "$WORK/tls.crt" >/dev/null 2>&1
"${KUBECTL[@]}" -n "$NAMESPACE" create secret tls atlas-tls \
  --cert "$WORK/tls.crt" --key "$WORK/tls.key" --dry-run=client -o yaml | "${KUBECTL[@]}" apply -f -

# --- install -----------------------------------------------------------------

step "helm lint"
helm lint --strict deploy/helm/atlas

step "helm upgrade --install, waiting for readiness"
"${HELM[@]}" upgrade --install "$RELEASE" deploy/helm/atlas \
  --namespace "$NAMESPACE" \
  --set image.repository="$REPOSITORY" \
  --set image.tag="$TAG" \
  --set image.pullPolicy=Never \
  --set ingress.enabled=true \
  --set ingress.host="$HOST" \
  --set ingress.tls.enabled=true \
  --set ingress.tls.secretName=atlas-tls \
  --wait --timeout 180s

ready="$("${KUBECTL[@]}" -n "$NAMESPACE" get deployment "$RELEASE" -o jsonpath='{.status.readyReplicas}')"
[ "$ready" = "2" ] || fail "expected 2 ready replicas, found '${ready:-0}'"
echo "2 of 2 replicas ready."

host="$("${KUBECTL[@]}" -n "$NAMESPACE" get ingress "$RELEASE" -o jsonpath='{.spec.rules[0].host}')"
secret="$("${KUBECTL[@]}" -n "$NAMESPACE" get ingress "$RELEASE" -o jsonpath='{.spec.tls[0].secretName}')"
[ "$host" = "$HOST" ] && [ "$secret" = "atlas-tls" ] || fail "Ingress has host '$host', TLS secret '$secret'"
echo "Ingress accepted for $host with TLS secret $secret (routing is the controller's job, and kind runs none)."

# --- what the pod is allowed to do ---------------------------------------------

in_pod() { "${KUBECTL[@]}" -n "$NAMESPACE" exec "deploy/$RELEASE" -- sh -c "$1" 2>/dev/null; }

step "The container runs as uid 101, on a read-only root, writing only /tmp"
uid="$(in_pod 'id -u')"
[ "$uid" = "101" ] || fail "container runs as uid $uid"
# Read from the mount table, not inferred from a failed write: as uid 101 a
# write to a root-owned path fails whether or not the filesystem is read-only,
# so a refused write proves nothing about the mount.
root_mount="$(in_pod "awk '\$2 == \"/\" { print \$4 }' /proc/mounts")"
case ",$root_mount," in
  *,ro,*) ;;
  *) fail "the root filesystem is mounted '$root_mount', not read-only" ;;
esac
in_pod 'echo x > /etc/nginx/nginx.conf' && fail "the server could rewrite its own configuration"
in_pod 'echo x > /tmp/probe && rm /tmp/probe' || fail "/tmp is not writable, and nginx needs it"
echo "uid 101; root filesystem mounted read-only; config not writable; /tmp writable."

# An A/B, because a refused connection on its own proves nothing: it could be
# DNS, TLS or a closed port. The address is the API server's ClusterIP, from
# the environment the kubelet injects, so no DNS is involved. It must be
# unreachable with the policy, reachable without it, and unreachable again.
reach_api() { in_pod 'nc -z -w 2 "$KUBERNETES_SERVICE_HOST" "$KUBERNETES_SERVICE_PORT"'; }
policy() {
  "${HELM[@]}" upgrade "$RELEASE" deploy/helm/atlas --namespace "$NAMESPACE" \
    --reuse-values --set networkPolicy.enabled="$1" --wait --timeout 60s >/dev/null
}
until_reach() {  # $1 = yes|no; a policy change takes a moment to program
  local want="$1" got
  for _ in $(seq 1 15); do
    if reach_api; then got=yes; else got=no; fi
    if [ "$got" = "$want" ]; then return 0; fi
    sleep 1
  done
  return 1
}

step "The pod cannot open a connection to anything, not even the API server"
until_reach no || fail "with the NetworkPolicy on, the pod reached the API server"
policy false
until_reach yes || fail "with the NetworkPolicy off the pod still cannot connect, so this check cannot tell"
policy true
until_reach no || fail "with the NetworkPolicy back on, the pod reached the API server"
echo "Egress refused by the policy, and only by the policy (open without it, refused again with it)."

# --- from inside, then from outside --------------------------------------------

step "helm test"
"${HELM[@]}" test "$RELEASE" --namespace "$NAMESPACE" --logs

step "HTTP smoke through a port-forward to the Service"
"${KUBECTL[@]}" -n "$NAMESPACE" port-forward "service/$RELEASE" "$PORT:80" >"$WORK/forward.log" 2>&1 &
FORWARD_PID=$!
disown "$FORWARD_PID" 2>/dev/null || true
for _ in $(seq 1 50); do
  node -e "fetch('http://127.0.0.1:$PORT/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" && break
  sleep 0.2
done
node scripts/smoke-http.mjs "http://127.0.0.1:$PORT" --build "$ATLAS_BUILD_ID"

if [ "$BROWSER" -eq 1 ]; then
  step "Browser: e2e/container.spec.ts through the same port-forward"
  ATLAS_CONTAINER_URL="http://127.0.0.1:$PORT" ATLAS_BUILD_ID="$ATLAS_BUILD_ID" \
    npx playwright test --config playwright.container.config.ts
fi

if [ "$GATEWAY_API" -eq 1 ]; then
  step "Gateway API $GATEWAY_API_VERSION: the chart's HTTPRoute against the real CRDs"
  "${KUBECTL[@]}" apply --server-side -f \
    "https://github.com/kubernetes-sigs/gateway-api/releases/download/$GATEWAY_API_VERSION/standard-install.yaml" >/dev/null
  "${KUBECTL[@]}" wait --for condition=Established --timeout 60s crd/httproutes.gateway.networking.k8s.io
  "${HELM[@]}" template "$RELEASE" deploy/helm/atlas --namespace "$NAMESPACE" \
    --set image.repository="$REPOSITORY" --set image.tag="$TAG" \
    --set httpRoute.enabled=true \
    --set httpRoute.hostnames[0]="$HOST" \
    --set httpRoute.parentRefs[0].name=shared \
    --set httpRoute.parentRefs[0].namespace=gateways \
    --show-only templates/httproute.yaml \
    | "${KUBECTL[@]}" apply --dry-run=server -f -
fi

printf '\nKind smoke passed: %s installed, hardened, isolated and serving the sample bundle.\n' "$ATLAS_IMAGE"
