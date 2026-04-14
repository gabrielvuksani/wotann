---
name: marketing-seo-ops
description: SEO operations workflow for keyword prioritization, striking-distance wins, competitor gaps, and trend capture
context: fork
paths: []
category: marketing
requires:
  anyBins: ["python3", "python"]
---

# Marketing SEO Ops

## Use This For
- Keyword research, content briefs, decaying-page recovery, or GSC-based prioritization.
- Competitor gap analysis and trend scouting.
- Turning traffic data into a ranked execution queue.

## Ranking Model
- Score opportunities on impact and confidence, then rank by the product of both.
- Impact should include business value, intent, and trend direction.
- Confidence should include attainable ranking distance, difficulty, and topic authority.

## Preferred Workflow
1. Pull striking-distance terms first; these are the fastest wins.
2. Compare current coverage against competitor gaps.
3. Check trend signals before proposing net-new content.
4. Separate BOFU, MOFU, and TOFU so execution matches business intent.
5. Return a prioritized queue with clear rationale, not a flat keyword dump.

## Output Standard
- Recommend the next pages to update, the next pages to create, and the pages to prune or refresh.
- Include the evidence behind each call: position band, demand, trend, and likely lift.
