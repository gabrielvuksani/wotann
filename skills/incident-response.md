---
name: incident-response
description: Systematic incident response for production outages and critical failures
context: fork
paths: ["**/*.log", "**/monitoring/**", "**/alerts/**"]
requires:
  bins: []
  env: []
---

# Incident Response Skill

Systematic incident response workflow for production outages, service degradation,
and critical failures. Follows industry-standard incident management practices
adapted for AI-assisted resolution.

## When This Activates

- User mentions "outage", "incident", "down", "production error"
- Error logs with severity CRITICAL or FATAL
- Monitoring alerts triggering
- Service health check failures
- Database connection failures
- API response times exceeding SLA thresholds

## Incident Severity Levels

| Level | Description | Response Time | Escalation |
|-------|-------------|---------------|------------|
| **SEV1** | Complete service outage, data loss risk | Immediate | Page on-call + engineering lead |
| **SEV2** | Major degradation, significant user impact | < 15 min | Notify on-call |
| **SEV3** | Minor degradation, workaround exists | < 1 hour | Normal channels |
| **SEV4** | Cosmetic issue, no user impact | Next business day | Ticket only |

## Incident Response Workflow

### Phase 1: Triage (0-5 minutes)

1. **Classify severity** using the table above
2. **Identify scope**:
   - Which services are affected?
   - Which users/regions are impacted?
   - Is data at risk?
3. **Check recent changes**:
   - `git log --oneline -20` for recent deploys
   - Check CI/CD pipeline status
   - Review recent config changes
4. **Establish timeline**: When did it start? Was there a triggering event?

### Phase 2: Diagnosis (5-30 minutes)

1. **Gather evidence systematically**:
   - Application logs (error patterns, stack traces)
   - Infrastructure metrics (CPU, memory, disk, network)
   - Database metrics (connections, slow queries, replication lag)
   - External dependency status (API providers, CDNs)

2. **Form hypotheses** (max 3 at a time):
   - H1: [Most likely cause based on evidence]
   - H2: [Second most likely]
   - H3: [Edge case to rule out]

3. **Test hypotheses** in order of likelihood:
   - For each: What evidence would confirm/deny?
   - Run targeted diagnostics (not shotgun debugging)
   - Document what you find

### Phase 3: Mitigation (Parallel with Diagnosis)

**Immediate actions** (do NOT wait for root cause):
- Roll back if recent deploy is suspected
- Scale up if resource exhaustion
- Failover if primary is unresponsive
- Rate limit if traffic spike
- Block bad actors if attack detected

**Communication**:
- Status page update with estimated resolution time
- Internal notification with severity and impact scope
- Regular updates every 15 minutes for SEV1, 30 minutes for SEV2

### Phase 4: Resolution

1. **Apply fix** (smallest possible change)
2. **Verify fix**:
   - Affected endpoints return 200
   - Error rates drop to baseline
   - Latency returns to normal
   - No new error patterns
3. **Monitor for regression** (minimum 30 minutes)

### Phase 5: Post-Incident

1. **Write incident report** (within 24 hours):
   ```
   ## Incident Report: [Title]
   
   **Severity:** SEVx
   **Duration:** HH:MM
   **Impact:** [Users/services affected]
   
   ### Timeline
   - HH:MM — [Event]
   - HH:MM — [Event]
   
   ### Root Cause
   [What actually went wrong]
   
   ### Resolution
   [What fixed it]
   
   ### Action Items
   - [ ] [Preventive measure 1]
   - [ ] [Preventive measure 2]
   
   ### Lessons Learned
   - [What we learned]
   ```

2. **Create action items** for prevention
3. **Update runbooks** with new failure mode
4. **Update monitoring** to catch this earlier next time

## Common Failure Patterns

### Database
- **Connection pool exhaustion**: Check `max_connections`, look for leaked connections
- **Replication lag**: Check network, disk I/O, long-running queries
- **Lock contention**: `SHOW PROCESSLIST`, `pg_locks` analysis
- **Disk full**: Check data growth, WAL archiving, temp files

### Application
- **Memory leak**: Check heap dumps, GC logs, object allocation rates
- **Thread pool exhaustion**: Check thread dumps, blocking I/O
- **Infinite loops**: CPU spike + identical stack traces
- **Cascading failures**: Service A times out → Service B queues → Service C OOMs

### Infrastructure
- **DNS resolution failures**: Check resolv.conf, DNS server health
- **Certificate expiry**: Check TLS cert dates across all endpoints
- **Resource exhaustion**: Check pods/containers for limits, node capacity
- **Network partition**: Check connectivity between services

### External Dependencies
- **Provider outage**: Check status pages, try alternate endpoints
- **Rate limiting**: Check response headers for retry-after
- **API breaking changes**: Compare request/response schemas

## Anti-Patterns (DO NOT)

- **Don't** immediately start changing code without understanding the problem
- **Don't** make multiple changes at once (impossible to know what fixed it)
- **Don't** skip the post-incident review
- **Don't** blame individuals — focus on systemic improvements
- **Don't** ignore "near-miss" incidents that resolved themselves
- **Don't** deploy fixes without testing, even under pressure

## Useful Commands

```bash
# Recent deploys
git log --oneline --since="2 hours ago"

# Application errors
grep -r "ERROR\|FATAL\|CRITICAL" /var/log/app/ --include="*.log" | tail -50

# Process state
ps aux --sort=-%mem | head -20
ps aux --sort=-%cpu | head -20

# Network connections
ss -tuln | grep LISTEN
ss -s  # Connection summary

# Disk usage
df -h
du -sh /var/log/*

# Docker/K8s
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
kubectl get pods -A | grep -v Running
kubectl top pods --sort-by=memory

# Database (PostgreSQL)
SELECT * FROM pg_stat_activity WHERE state = 'active';
SELECT * FROM pg_locks WHERE NOT granted;
```

## Integration with WOTANN

This skill integrates with:
- **Autonomous mode**: Can run diagnosis autonomously within safety bounds
- **Memory**: Records incident patterns for future reference
- **Channels**: Sends status updates to Slack/Discord/email
- **Hooks**: Triggers on error rate spikes detected by monitoring
- **Episodic memory**: Full incident narrative stored for post-mortem
