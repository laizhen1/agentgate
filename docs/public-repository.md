# Public repository hygiene

This repository uses GitHub usernames and GitHub-provided no-reply addresses for
commit attribution. Before committing, configure `user.name` and `user.email`
locally for this repository using your GitHub username and the no-reply address
shown in your GitHub email settings. Do not copy another contributor's address.

The checked-in `.openai/hosting.json` contains a generic project identifier.
Local development uses its `DB` binding and does not require a personal hosting
project ID. Keep any account-specific hosting configuration in the ignored
`.openai/hosting.local.json` file; this backup is not loaded automatically.
Configure the appropriate project ID explicitly when deploying to your own host.

Before publication, run:

```sh
python scripts/check-public-repo.py
```

The check inspects tracked files and ZIP contents for common credential patterns,
personal home-directory paths, and account-linked hosting IDs. It also checks
available commit email addresses and verifies frozen experiment and bundle hashes.
CI runs the same check. It does not identify every possible kind of personal
information, so manual review remains necessary.

Keep `.env*`, `.dev.vars*`, credentials, local databases, checkpoints, caches, and
private backups out of Git. Public synthetic examples use fictional addresses;
third-party author credits and source licenses are preserved.

When removing previously published personal information, inspect reachable Git
history, downloadable archives, workflow metadata/logs, releases, issues, and
pull requests. A normal deletion commit does not remove historical copies.
Rewriting history changes commit IDs; existing collaborators should re-clone or
carefully reconcile their clones without restoring the old history. Cached
commits and copies outside the repository may remain accessible and can require
GitHub Support or the copy owner's assistance.

References: [GitHub commit email settings](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address)
and [removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
