---
name: kubernetes-specialist
description: Kubernetes manifests, Helm, operators, multi-cluster patterns
context: fork
paths: ["**/k8s/**", "**/kubernetes/**", "**/helm/**", "**/Chart.yaml", "**/*.yaml"]
---

# Kubernetes Specialist

## When to Use
- Authoring or reviewing Deployments, StatefulSets, Jobs, CronJobs.
- Packaging workloads with Helm or Kustomize.
- Building or reviewing a Kubernetes operator (controller-runtime, kubebuilder).
- Diagnosing pod/service/ingress misbehavior.
- Planning multi-tenant or multi-cluster topologies.

## Rules
- Set resource requests AND limits on every container.
- Use readiness + liveness + startup probes — never trust "it's running".
- Never run as root; set `securityContext.runAsNonRoot: true`.
- Pin image tags to immutable digests in production.
- Separate config (ConfigMap/Secret) from image.
- Namespaces for boundaries, NetworkPolicies for enforcement.

## Patterns
- **Blue-green** via two Deployments + Service selector swap.
- **Canary** via Argo Rollouts or Flagger with analysis templates.
- **GitOps** (Argo CD / Flux) — cluster state follows a git repo.
- **Operator pattern** for stateful apps (databases, queues, ML).
- **HPA + VPA** for horizontal and vertical autoscaling.
- **PodDisruptionBudget** to protect quorum during evictions.

## Example
```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: api, labels: { app: api } }
spec:
  replicas: 3
  strategy: { type: RollingUpdate, rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } }
  selector: { matchLabels: { app: api } }
  template:
    metadata: { labels: { app: api } }
    spec:
      securityContext: { runAsNonRoot: true, fsGroup: 2000 }
      containers:
        - name: api
          image: ghcr.io/acme/api@sha256:abcd1234
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits:   { cpu: 500m, memory: 512Mi }
          readinessProbe: { httpGet: { path: /ready, port: 8080 }, periodSeconds: 5 }
          livenessProbe:  { httpGet: { path: /live,  port: 8080 }, periodSeconds: 10 }
```

## Checklist
- [ ] Every container has requests + limits.
- [ ] Every Deployment has readiness + liveness probes.
- [ ] NetworkPolicies deny-by-default, allow-by-exception.
- [ ] Secrets come from Vault/ASM/GSM, not raw Secret objects.
- [ ] PodDisruptionBudget protects quorum services.

## Common Pitfalls
- **`resources: {}`** — one pod hogs the whole node.
- **`:latest` tag** — rollbacks become impossible.
- **Ignoring PodSecurity standards** — compliance audits fail.
- **One-pod StatefulSets** with no quorum.
- **HPA on CPU** for I/O-bound or queue-bound workloads.
