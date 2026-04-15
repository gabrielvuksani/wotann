---
name: mcp-marketplace
description: Discover, install, audit, and manage MCP (Model Context Protocol) servers from the community registry. Use when adding new tools or capabilities from external MCP sources.
---

# MCP Marketplace Discovery

Use when: discovering, installing, auditing, or managing MCP (Model Context Protocol) servers
from the community marketplace.

## Features
- **Registry Search**: Search for MCP servers by name, capability, or category
- **Auto-Install**: npm/pip install + config injection into .wotann/mcp-servers.json
- **Security Audit**: Scan MCP server code for: eval(), exec(), network exfil, prompt injection
- **Version Pinning**: Lock MCP server versions for reproducible setups
- **Health Monitoring**: Track MCP server response time, error rates, uptime

## Registry Format
```yaml
name: github-mcp
version: 2.1.0
author: modelcontextprotocol
description: GitHub API integration via MCP
tools:
  - create_issue
  - search_code
  - list_pull_requests
security:
  audited: true
  last_audit: 2026-03-15
  network_access: true
  file_access: false
install: npm install @modelcontextprotocol/github-mcp
```

## Security Scan Protocol
1. Clone/download the MCP server source
2. Scan for dangerous patterns: eval, exec, spawn, fetch to unknown hosts
3. Check dependencies for known vulnerabilities (npm audit / pip audit)
4. Verify tool schemas match advertised capabilities
5. Rate risk: LOW / MEDIUM / HIGH / CRITICAL
6. Auto-reject CRITICAL, warn on HIGH, inform on MEDIUM

## Categories
- Code Intelligence (GitHub, GitLab, Bitbucket)
- Database (PostgreSQL, MongoDB, Redis)
- Communication (Slack, Discord, Email)
- Cloud (AWS, GCP, Azure)
- Monitoring (DataDog, PagerDuty)
- AI/ML (HuggingFace, Replicate)
- Productivity (Notion, Linear, Jira)
