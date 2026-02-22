# Security Policy

## Supported versions

Security fixes are applied to the latest development branch and latest stable release branch when applicable.

## Reporting a vulnerability

Do not disclose security issues in public issues or discussions.

Preferred process:
1. Use GitHub private vulnerability reporting (Security Advisory) for this repository.
2. Include:
   - affected files/components
   - impact and attack scenario
   - reproduction steps or proof of concept
   - suggested mitigation if available

If private reporting is unavailable, open an issue with minimal details and title prefix `[SECURITY]`, and request a private follow-up channel.

## Operational security notes

- Never commit tokens, keys, cookies, or production secrets.
- Treat relay logs and uploaded artifacts as sensitive.
- Keep upload roots and workdir allowlists as narrow as possible.
- Avoid permissive settings in shared/public deployments unless strictly required.
