# Security Checklist

Use a clean repository with no inherited git history when publishing Archie-derived workflows.

Before the first public commit:

1. Rotate any credentials that were present in private OpenClaw profile files.
2. Confirm `git ls-files` does not include runtime state, credentials, databases, backups, logs, sessions, or local profile config.
3. Run a secret scanner against the whole repository.
4. Review examples and docs for personal paths, private project names, real account identifiers, and local service credentials.

Files that must stay out of the public repo:

- `.env`
- `openclaw.json` with real values
- auth profile JSON or SQLite databases
- gateway tokens
- Telegram bot tokens and offset files
- device identity and pairing credentials
- memory databases
- cron runtime state
- logs and stability bundles
- chat/session transcripts
- generated npm/plugin state
