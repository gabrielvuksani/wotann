---
name: rails-expert
description: Rails 7+, Active Record, Turbo, Hotwire, testing
context: fork
paths: ["**/*.rb", "**/Gemfile"]
requires:
  bins: ["ruby", "rails"]
---
# Rails Expert
## Rules
- Use Rails 7+ with Hotwire (Turbo + Stimulus) for interactivity.
- Fat models, skinny controllers. Business logic in models/services.
- Use ActiveRecord callbacks sparingly (prefer service objects).
- Use strong parameters for mass assignment protection.
## Patterns
- Service objects for complex business logic.
- Concerns for shared model behavior.
- Turbo Frames for partial page updates.
- Turbo Streams for real-time updates.
## Testing
- RSpec with FactoryBot for fixtures.
- System tests with Capybara for E2E.
- Request specs for API testing.
