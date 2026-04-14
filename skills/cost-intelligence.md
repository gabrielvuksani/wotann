# Cost Intelligence — Real-Time Budget Management

Use when: monitoring and optimizing AI API costs across multiple providers.
Provides real-time cost tracking, budget alerts, model routing for cost efficiency,
and usage analytics.

## Features

### Real-Time Cost Tracking
- Track cost per query, per session, per provider, per model
- Display running total in TUI status bar
- Alert when approaching budget thresholds (50%, 75%, 90%, 100%)

### Model-Cost Router
Route queries to the cheapest capable model:
- Simple questions → Haiku / Flash / Nano ($0.25-0.80/M tokens)
- Standard coding → Sonnet / GPT-5.4-mini ($3/M tokens)
- Complex architecture → Opus / GPT-5.4 ($5-15/M tokens)
- Local when possible → Ollama (free)

### Cost Optimization Strategies
1. **Prompt caching**: Reuse cached system prompts (2.5x cheaper on Anthropic)
2. **Context truncation**: Remove old context before hitting expensive tiers
3. **Batch queries**: Combine multiple small queries into one (fewer API calls)
4. **Model stepping**: Start with cheap model, escalate only on failure
5. **Local-first routing**: Use Ollama for simple tasks, API for complex

### Budget Controls
```yaml
# .wotann/budget.yaml
daily_limit_usd: 25.00
session_limit_usd: 5.00
per_query_limit_usd: 0.50
alert_thresholds: [0.5, 0.75, 0.9]
auto_downgrade:
  at_75_percent: prefer_cheaper_model
  at_90_percent: local_only
  at_100_percent: block_api_calls
```

### Analytics
- Daily/weekly/monthly cost reports
- Cost per feature (tag queries with feature names)
- Provider comparison (same query, different providers)
- Token efficiency (output quality per dollar spent)
