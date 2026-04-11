# Domain Gap Checklist — Data Analysis

Before searching, evaluate the spec against these common gaps. Focus your research on areas where the spec is silent or vague.

## Data Sources

- Ingestion format and schema documented (CSV, JSON, API, DB)?
- Update frequency and freshness requirements specified?
- Data volume and growth projections estimated?
- Source reliability and quality track record assessed?

## Data Quality

- Missing value handling strategy defined?
- Outlier detection and treatment rules specified?
- Validation rules and data type constraints documented?
- Cleaning and transformation steps reproducible?

## Pipeline Architecture

- Batch vs streaming processing decision made?
- Scheduling and orchestration tool specified?
- Idempotency guarantees for re-runs?
- Failure handling and retry logic documented?

## Storage & Format

- File formats chosen for each pipeline stage?
- Database or warehouse selection justified?
- Partitioning and indexing strategy for query performance?
- Retention policy and archival rules defined?

## Visualization

- Chart types and visual encodings appropriate for the data?
- Interactivity requirements specified (filters, drill-down, tooltips)?
- Accessibility of visualizations (alt text, colorblind-safe palettes)?
- Export and sharing formats documented?

## Statistical Methods

- Assumptions stated and validated for chosen methods?
- Significance levels and confidence intervals specified?
- Bias sources identified and mitigation planned?
- Sample size and power analysis performed?

## Reproducibility

- Data and code versioning strategy in place?
- Environment and dependency management documented?
- Random seeds set for stochastic processes?
- Notebook or script execution order clear and linear?

## Privacy & Compliance

- PII identified and handling rules specified?
- Anonymization or pseudonymization methods chosen?
- Consent and data usage agreements in place?
- Regulatory requirements identified (GDPR, HIPAA, CCPA)?
