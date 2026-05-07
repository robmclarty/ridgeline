import {
  aborted_error,
  engine_config_error,
  model_not_found_error,
  on_chunk_error,
  provider_capability_error,
  provider_error,
  provider_not_configured_error,
  rate_limit_error,
  schema_validation_error,
  tool_approval_denied_error,
  tool_error,
} from "fascicle"

const RETRYABLE_PROVIDER_STATUSES = new Set([500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511])

const isRetryableProviderError = (err: provider_error): boolean => {
  const status = err.status
  if (status === undefined) return true
  if (status >= 500 && status < 600) return true
  if (RETRYABLE_PROVIDER_STATUSES.has(status)) return true
  return false
}

export const shouldRetry = (err: unknown): boolean => {
  if (err instanceof aborted_error) return false
  if (err instanceof engine_config_error) return false
  if (err instanceof model_not_found_error) return false
  if (err instanceof schema_validation_error) return false
  if (err instanceof tool_approval_denied_error) return false
  if (err instanceof provider_capability_error) return false
  if (err instanceof provider_not_configured_error) return false
  if (err instanceof tool_error) return false

  if (err instanceof rate_limit_error) return true
  if (err instanceof on_chunk_error) return true
  if (err instanceof provider_error) return isRetryableProviderError(err)

  return false
}
