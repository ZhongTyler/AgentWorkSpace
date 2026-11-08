# Independent module protocol v1 and AWS catalog v2

## Module identity and inventory

module.json schema_version 1 declares id, name, independent version, HTTPS repository, payload location, human/agent/manager entry points, runtime requirements, provided capabilities, optional capabilities, module-entry interface version, related peers and source provenance. Meta retains its complete workspace payload. Other modules use their repository root as the payload.

module-files.json fixes the same module id/version and SHA-256 of every delivered file except itself and Git/generated runtime metadata. The manager rejects changed, missing or extra module files and linked paths. Author sealing requires an explicit tracked-file inventory so unreviewed user files cannot enter it automatically. Original licenses are delivered unchanged.

## Optional cooperation

module-entry@1 provides discoverable identity, documented task entry and handoff conditions. It does not certify a business adapter or authorize execution. Each module's cooperation guide states responsibilities, I/O/entrypoints, authority/data ownership and recovery. Domain schemas and feature-specific tool versions retain their existing owners.

Related peers are optional, published repository/version references. Direct retrieval stages and verifies a peer, then installs it at a sibling workspace location. Matching verified instances can be reused. Modified, duplicated or different-version instances require owner review. Failed retrieval records actual staging/installed state and remains recoverable for inspection.

Shared manager and panorama tools are built from one generic source and delivered with each module. Runtime uses local code and module.json. AWS and meta remain optional integration layers.

## Aggregate catalog

catalog schema_version 2 records the AWS combination version, predecessor, capability contract and each module's version, repository, immutable Git commit, module manifest/inventory digests, payload file hashes, runtime and optional relationships. The aggregate stores gitlinks at meta and packages/<id>. Recipient paths remain modules/<id>, with the existing full-meta root layout retained for migration.

Metadata validation does not require downloaded payloads. verify reports metadata_verified, verified_modules and not_downloaded separately. fetch explicitly retrieves selected modules or all modules. Normal installation may retrieve missing selected sources before revalidating the recipient transaction. Source downloads and recipient mutations use separate locks and records.

## Installed state and compatibility

The existing schema 1 transaction engine is retained. A 2.x installation adds module_format 2 and per-component manifest identities. Modules can have independent versions. Same-version manifest mutation and unrecorded downgrade are refused. Existing user edits follow original baseline conflict rules.

Verified external instances are recorded under external_modules with actual relative path, version and manifest identity. They keep their files and Git ownership. AWS registration rollback preserves them. Business interoperability still needs the semantic package review.

## Historical migration

The 1.30.0 distribution is the actual predecessor, with its original metadata and capability requirements. Migration to 2.0.0 preserves full/compatible mode, private data and independent project copies. Client Skill selection and upgrade remain separate transactions. Reverse recovery uses recorded byte baselines, and refuses later owner edits.
