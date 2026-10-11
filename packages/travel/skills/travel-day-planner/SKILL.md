---
name: travel-day-planner
description: Plan or refine a travel day using fixed bookings, adjacent-day constraints, topic research and exact route endpoints, then update structured facts and offline views.
---

# Plan a day

Read [contract](../../运行/数据合同.md) and [day workflow](../../流程/04-逐日安排与路线.md). Commands run from package root two levels above.
For in-trip changes, read [operations](../../运行/旅途中调整与时间约束.md): preserve actual/past evidence, protect real experience minutes separately from transfers, check distinct deadlines, and feed observed map durations back into the timetable. Respect paused research channels before considering MCP; local evidence and official sources remain usable.

1. Read target and adjacent dates, party counts, bookings, lodging and decisions. Do not resurrect rejected options.
2. Identify decision-changing gaps. Existing candidates first; sibling capture/digest skills plus official sources. Retain new evidence in topic Wiki.
3. Calculate usable time: luggage, transfers, parking/walking, meals, queues, recovery and buffers. Compare concrete experiences and cost.
4. One default and meaningful branches. Research-only leaves days unchanged; authorized adoption updates trip.json.
5. Reuse place/catalog/order IDs and one todos collection. Route scaffolds need mode/endpoint review per [map protocol](../../运行/地图维护.md).
6. Run validate, budget, sync, build. Re-read changed journal semantics and inspect actual browser views. Missing evidence stays explicit; tests do not prove tourism feasibility.
