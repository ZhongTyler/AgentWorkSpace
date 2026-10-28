# Optional research reports

This is an empty recipient-owned catalog. Reports remain in their own explicitly bound storage; installation does not ingest reports or copy private dossiers. `createLocalResearchHost(localResearchOptions(root))` adds discovery only when `system/query/research.local.json` explicitly enables bindings. Without it, ordinary Wiki/Raw Query remains available.

The config uses `schema_version: 1`, `enabled: true` and `bindings` mapping recipient-chosen names to absolute library roots. Catalog entries use the `research-dossier-v1` provider contract in system/integrations/research-reports.mjs. Register only an accepted, versioned original dossier; use research-reports-accept.mjs to inspect its acceptance data. Discovery is not reading or claim verification. Rejected, unread, stale, missing, cyclic or unaccepted evidence cannot support a verified result. Partial dossiers retain their limits. Tests construct synthetic reports and do not distribute real cases.
