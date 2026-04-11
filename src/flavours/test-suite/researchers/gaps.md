# Domain Gap Checklist — Test Suite

Before searching, evaluate the spec against these common gaps. Focus your research on areas where the spec is silent or vague.

## Coverage Strategy

- Unit, integration, and e2e test ratio defined?
- Critical path and high-risk area coverage prioritized?
- Coverage thresholds set and enforced in CI?
- Negative test cases and error paths included?

## Test Data

- Fixtures and factories organized and reusable?
- Seed data strategy for integration and e2e tests?
- Test data cleanup and isolation between runs?
- Sensitive data excluded from test fixtures?

## Environment

- Test isolation guaranteed (no shared mutable state)?
- Parallel execution supported and configured?
- CI integration with proper caching and artifact handling?
- Environment parity with production (containers, services)?

## Assertions

- Assertions specific enough to catch regressions?
- Custom matchers created for domain-specific checks?
- Snapshot testing used appropriately with review process?
- Assertion messages descriptive for failure diagnosis?

## Mocking & Stubbing

- External dependencies mocked at appropriate boundaries?
- Time and date mocking for time-sensitive logic?
- Randomness seeded for deterministic tests?
- Mock fidelity verified against real implementations?

## Performance Testing

- Load targets and throughput benchmarks defined?
- Performance regression detection automated?
- Benchmark baseline established and tracked?
- Resource usage (memory, CPU) monitored during tests?

## Edge Cases

- Boundary values tested for all inputs?
- Error paths and exception handling exercised?
- Concurrent access and race conditions addressed?
- Empty, null, and malformed input scenarios covered?

## Maintainability

- Test naming conventions established and followed?
- Helper functions and utilities shared across suites?
- Flaky test detection, tracking, and resolution process?
- Test documentation and organization strategy clear?
