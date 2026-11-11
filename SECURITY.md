# Security

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub's security advisories](https://github.com/beanski/lulu-print-mcp/security/advisories/new), not in a public issue. We aim to reply within a week.

## How this server handles your data

- It runs on your own machine and talks only to Lulu's API: `api.lulu.com` or `api.sandbox.lulu.com`.
- Your client key and secret are read from environment variables and sent only to Lulu's login endpoint. They never appear in tool output or error messages.
- It never downloads your book files. It passes the URLs to Lulu, and Lulu downloads them.
- Path ids may only contain letters, digits, `-` and `_`, so a tool argument can't change which API path is called.
- It retries only requests that are safe to repeat (GETs). If an order request fails partway, it never retries, so an order can't be placed twice.
