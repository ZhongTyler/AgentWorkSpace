---
name: travel-presentation
description: Design and refine a source-backed offline travel website and illustrated handbook, with readable daily experiences, contextual detail and real-browser visual review. Use when creating or reshaping travel presentation, not for isolated factual travel questions.
---

# Travel presentation

Read the workflow's [presentation contract](../../运行/品质复现与验收.md). If the host has frontend-design or editorial, read the relevant skill completely as well; this bundled skill remains sufficient in a new workspace without them. For Chinese prose, read the complete bundled [Humanizer](../humanizer-zh/SKILL.md).

Before editing, identify the reader's primary task and write a compact design brief in the trip: visual direction, type and colour choices, first-screen hierarchy, mobile behaviour, available imagery and its rights. Derive the direction from this destination and the user's preferences; do not make every trip blue or copy another traveller's facts.

First screen: explain this journey through concrete experiences and a clear reading entrance. Daily screen: what happens, where to go, essential deadlines, then optional background. Guide screen: a useful conclusion and a relevant detail link. Put acquisition logs, confidence accounting and implementation notes in project reports, not in repeated tourist-facing paragraphs. Keep safety conditions beside the affected action.

Use trip.json and knowledge as the editing sources. Reuse catalogue, bookings and place IDs; do not hand-copy facts into components. Descriptive material should explain the actual experience and its tradeoffs. Avoid empty captions, identical decorative cards for every content type, and repeated summary/detail text. No activity on a transfer day is fine: show its real departure and arrival arrangements rather than an empty scaffold.

Use real, attributable and permitted images when available. Do not represent diagrams as photographs or ordered stops as a road map. If acquisition is excluded, work with the existing media and disclose the remaining visual gap in the quality report. A better layout does not validate a destination pin or historical opening hours.

Review at least a representative complex day, a quiet/transfer day, dining, a place card, a Wiki and the handbook at desktop and mobile widths. Actually open and operate the offline file, check reading hierarchy and image loading, and inspect the screenshots. Fix issues found; a build or screenshot without inspection is not visual acceptance. Record engineering results separately from the editor's judgement and the user's acceptance.

When the user approves a sample and asks to expand or audit the whole site, inspect every active module and day section, including alternatives, expanded details, place cards and Wiki dialogs. Use the optional [visual audit](../../运行/视觉层级与全量巡检.md) to inventory screens and produce full screenshots/contact sheets. Review those images yourself; the script must not mark editorial or human acceptance. Keep one generic renderer after backporting: remove trial overrides created for this task, preserve their historical report, rebuild the trip and verify the packaged workflow in a clean fixture.

Use semantic visual roles rather than font size alone: a distinctive day overview, a solid active primary tab, quiet secondary tools, content surfaces for actions, a warm boundary surface for deadlines/bookings, and separate arrival controls versus supporting reading links. Number only actual sequences. Do not turn disjoint schedule ranges into one continuous activity duration. Apply the hierarchy to maps, orders, dining, guides and dialogs while keeping the handbook a continuous reading experience. Colours may change with the destination; the roles and accessibility checks should remain.
