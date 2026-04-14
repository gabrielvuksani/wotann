---
name: cloud-architect
description: AWS, GCP, Azure architecture patterns, well-architected reviews
context: fork
paths: ["**/terraform/**", "**/cloudformation/**", "**/*.tf", "**/infra/**"]
---

# Cloud Architect

## When to Use
- Designing a new cloud workload or reviewing an existing one.
- Choosing between serverless, containers, or VMs for a workload.
- Running a Well-Architected Framework review (reliability, security, cost, performance, ops, sustainability).
- Multi-region or multi-AZ high-availability planning.
- Cost optimization passes or reserved-capacity analysis.

## Rules
- Start with SLO (availability, latency, RPO/RTO); architecture follows.
- Prefer managed services unless you have a clear reason to self-operate.
- Design for failure — every single-point-of-failure has a documented mitigation.
- Make cost a first-class architectural constraint, not a post-hoc review.
- Codify infrastructure (Terraform/Pulumi/CDK) — no click-ops in production.
- Use IAM least-privilege scoped to resource ARN, not `*`.

## Patterns
- **Three-tier**: ALB → stateless app fleet → managed DB with read replicas.
- **Event-driven**: producers → SQS/PubSub/EventBridge → consumers with DLQ.
- **Multi-region active-passive**: Route 53 health check failover, DB replication with replay.
- **Hub-and-spoke**: shared services VPC for networking primitives, workload VPCs peered.
- **Landing zone**: Control Tower / GCP Organization / Azure Management Groups.

## Example
```hcl
# Multi-AZ web tier with ELB health check and rolling instance refresh.
resource "aws_autoscaling_group" "web" {
  name                = "web-${var.env}"
  min_size            = 3
  max_size            = 12
  desired_capacity    = 3
  vpc_zone_identifier = module.vpc.private_subnets
  health_check_type   = "ELB"
  target_group_arns   = [aws_lb_target_group.web.arn]
  instance_refresh { strategy = "Rolling" }
}
```

## Checklist
- [ ] Every tier spans at least two AZs.
- [ ] Data encrypted at rest (KMS) and in transit (TLS 1.2+).
- [ ] A cost estimate (Infracost) accompanies the PR.
- [ ] Observability covers USE method: Utilization, Saturation, Errors.
- [ ] Runbook entry exists for each known failure mode.

## Common Pitfalls
- **NAT gateway sprawl** — one per AZ adds real money; share where policy allows.
- **Over-permissive IAM** — `Resource: "*"` on S3 or Secrets Manager.
- **Egress blindness** — no logging or anomaly detection on outbound traffic.
- **Autoscaling on CPU alone** for queue workers; use queue depth.
- **Single-region DB** for "critical" workloads with no tested DR plan.
