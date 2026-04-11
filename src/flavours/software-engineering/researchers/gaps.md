# Domain Gap Checklist — Software Engineering

Before searching, evaluate the spec against these common gaps. Focus your research on areas where the spec is silent or vague.

## Architecture

- System boundaries and service decomposition defined?
- Communication patterns specified (sync, async, event-driven)?
- Data flow and ownership between services documented?
- Technology selection justified with trade-off analysis?

## API Design

- Versioning strategy specified (URL, header, query param)?
- Pagination, filtering, and sorting patterns defined?
- Error codes and response format standardized?
- Rate limiting and throttling policy documented?

## Database

- Schema design and entity relationships documented?
- Indexing strategy aligned with query patterns?
- Migration plan and tooling specified?
- Backup frequency and recovery time objectives?

## CI/CD

- Pipeline stages and quality gates defined?
- Test coverage thresholds and required checks?
- Deployment strategy specified (blue-green, canary, rolling)?
- Rollback procedure and criteria documented?

## Observability

- Logging strategy (structured, levels, retention policy)?
- Metrics and dashboards for key business and system health?
- Distributed tracing for cross-service requests?
- Alerting thresholds and escalation procedures?

## Security

- Authentication and authorization model specified?
- Input validation boundaries and sanitization rules?
- Secrets management and rotation policy?
- Dependency scanning and vulnerability patching cadence?

## Scalability

- Bottleneck identification and load testing plan?
- Caching strategy and invalidation rules?
- Horizontal and vertical scaling approach documented?
- Resource budgets and auto-scaling triggers defined?

## Developer Experience

- Local development setup documented and reproducible?
- API and architecture documentation current?
- Onboarding guide for new contributors?
- Code review standards and contribution guidelines?
