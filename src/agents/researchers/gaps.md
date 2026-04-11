# Domain Gap Checklist — Software Projects

Before searching, evaluate the spec against these common gaps. Focus your research on areas where the spec is silent or vague.

## Deployment & Operations

- Deployment strategy specified (blue-green, rolling, canary)?
- Environment configuration management (secrets, env vars)?
- Health checks, readiness probes, graceful shutdown?
- Backup and disaster recovery?

## Observability

- Logging strategy (structured, levels, retention)?
- Metrics and monitoring (what to measure, alerting thresholds)?
- Distributed tracing for multi-service systems?
- Error tracking and reporting?

## Error Handling & Resilience

- Failure modes identified for external dependencies?
- Retry strategies, circuit breakers, timeouts?
- Graceful degradation when subsystems fail?
- Data consistency guarantees under failure?

## Security

- Authentication and authorization model?
- Input validation and sanitization boundaries?
- Data encryption (at rest, in transit)?
- Rate limiting, abuse prevention?
- Dependency vulnerability management?

## Data & Storage

- Data migration strategy for schema changes?
- Data retention and archival policies?
- Backup frequency and recovery time objectives?
- Cache invalidation strategy?

## Performance

- Latency targets for key operations?
- Throughput expectations and load testing plan?
- Resource budgets (memory, CPU, bandwidth)?
- Scalability approach (horizontal, vertical)?

## User Experience

- Accessibility requirements (WCAG level)?
- Internationalization and localization?
- Offline behavior or degraded network handling?
- Loading states, progress indicators, error messages?

## Testing

- Test strategy specified (unit, integration, e2e)?
- Test data management?
- Performance and load testing?
- Acceptance criteria verifiable without human judgment?

## Integration

- API contracts and versioning strategy?
- Third-party service dependencies and SLAs?
- Webhook/event handling and delivery guarantees?
- Migration path from existing systems?
