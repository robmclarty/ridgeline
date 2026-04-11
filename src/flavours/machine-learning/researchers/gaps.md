# Domain Gap Checklist — Machine Learning

Before searching, evaluate the spec against these common gaps. Focus your research on areas where the spec is silent or vague.

## Data Pipeline

- Training, validation, and test split ratios defined?
- Data augmentation strategy specified?
- Preprocessing and feature engineering steps documented?
- Data labeling quality and inter-annotator agreement?

## Model Architecture

- Model selection rationale documented (why this architecture)?
- Key hyperparameters identified with initial values?
- Baseline model defined for comparison?
- Input/output shapes and data flow specified?

## Training

- Hardware requirements estimated (GPU type, count, memory)?
- Expected training time and compute budget?
- Checkpointing frequency and storage strategy?
- Early stopping criteria and learning rate schedule?

## Evaluation

- Primary and secondary metrics chosen and justified?
- Confusion matrix and error analysis planned?
- A/B testing or shadow deployment strategy?
- Fairness metrics across demographic groups?

## Deployment

- Serving infrastructure specified (API, edge, batch)?
- Inference latency and throughput targets defined?
- Model versioning and rollback strategy?
- Input validation and preprocessing parity with training?

## Monitoring

- Data drift detection method and thresholds?
- Model performance degradation alerting?
- Prediction logging and feedback loop design?
- Retraining triggers and cadence defined?

## Reproducibility

- Random seeds set for all stochastic components?
- Environment and dependency versions pinned?
- Experiment tracking tool and metadata logging?
- Dataset versioning and lineage documented?

## Ethics & Bias

- Fairness across demographic groups evaluated?
- Model explainability and interpretability approach?
- Consent and data usage rights verified?
- Failure modes and harm scenarios identified?
