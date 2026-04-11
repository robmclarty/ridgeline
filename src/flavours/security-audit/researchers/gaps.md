# Domain Gap Checklist — Security Audit

Before searching, evaluate the spec against these common gaps. Focus your research on areas where the spec is silent or vague.

## Attack Surface

- Network exposure and open ports enumerated?
- API surface and public endpoints catalogued?
- Input vectors identified (forms, file uploads, query params)?
- Third-party integrations and trust boundaries mapped?

## Authentication & Authorization

- Auth flow documented (OAuth, SAML, MFA)?
- Session management and token lifecycle specified?
- Privilege escalation paths reviewed?
- Role-based or attribute-based access control defined?

## Data Protection

- Encryption at rest and in transit specified (algorithms, key length)?
- Key management and rotation policy documented?
- PII inventory and classification completed?
- Data masking and redaction rules for logs and exports?

## Vulnerability Classes

- Injection risks assessed (SQL, command, LDAP, template)?
- XSS prevention strategy (CSP, output encoding)?
- CSRF and SSRF protections in place?
- Deserialization and file upload risks addressed?

## Infrastructure

- Cloud configuration hardened (IAM, security groups, buckets)?
- Container security (base images, scanning, runtime policies)?
- Secrets management (vault, rotation, no hardcoded secrets)?
- Network segmentation and firewall rules reviewed?

## Compliance

- Regulatory requirements identified (SOC 2, PCI-DSS, GDPR)?
- Audit logging coverage and retention specified?
- Data residency and sovereignty requirements met?
- Penetration testing schedule and scope defined?

## Incident Response

- Detection and alerting mechanisms in place?
- Incident classification and severity levels defined?
- Runbook and escalation procedures documented?
- Recovery procedures and RTO/RPO targets specified?

## Supply Chain

- Dependency audit completed (known vulnerabilities)?
- Software bill of materials (SBOM) generated?
- Update and patching policy documented?
- Version pinning and lock file enforcement?
