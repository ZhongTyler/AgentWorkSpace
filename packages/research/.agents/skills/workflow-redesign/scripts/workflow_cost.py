"""Observe workflow costs and render evidence-backed assessments using only stdlib."""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def timestamp(value):
    require(isinstance(value, str), "Timestamp must be a string")
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(result.tzinfo is not None, "Timestamp needs an explicit timezone")
    return result


def now():
    return datetime.now(timezone.utc).isoformat()


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


@contextmanager
def writer(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    lock = path.with_name(path.name + ".lock")
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    try:
        os.close(descriptor)
        yield
    finally:
        lock.unlink()


def save(path, value):
    """Called under writer lock. Failed writes preserve the preceding record."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n",
                                         dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def timeline(events):
    require(not events or events[0].get("phase") is not None, "Timeline must start with a phase")
    phases = {}
    intervals = []
    for index, event in enumerate(events):
        current = timestamp(event["at"])
        phase = event.get("phase")
        require(phase is None or isinstance(phase, str) and phase.strip(), "Invalid phase")
        require(phase is not None or index == len(events) - 1, "Event after finish")
        require(isinstance(event.get("resumed", False), bool), "Invalid resume flag")
        if index:
            previous = events[index - 1]
            seconds = (current - timestamp(previous["at"])).total_seconds()
            require(seconds >= 0, "Events must be chronological")
            label = "unallocated" if event.get("resumed") else previous["phase"]
            phases[label] = phases.get(label, 0) + seconds
            intervals.append({"start": previous["at"], "end": event["at"],
                              "phase": label, "seconds": seconds})
    return {"closed": bool(events) and events[-1].get("phase") is None,
            "phase_seconds": phases, "intervals": intervals,
            "boundary": "Observed wall-clock boundaries, including in-phase waits. "
                        "Open tail and pre-start time are unmeasured. Not model or human active time."}


def validate(record):
    require(record.get("schema_version") == 1 and record.get("kind") == "workflow_cost_effect",
            "Unsupported record schema")
    require(record.get("mode") in ("prospective", "retrospective"), "Invalid mode")
    task = record["task"]
    for key in ("id", "workflow", "purpose", "scope", "complexity", "quality_floor", "result_unit"):
        require(isinstance(task.get(key), str) and task[key].strip(), "Missing task field: " + key)
    sources = record.get("sources", {})
    for key, source in sources.items():
        require(source.get("path") and source.get("locator"), "Source needs path and locator: " + key)
        digest = source.get("sha256", "")
        require(len(digest) == 64 and all(c in "0123456789abcdef" for c in digest), "Source needs SHA256: " + key)
    observations = record.get("observations", [])
    ids = [item["id"] for item in observations]
    require(len(ids) == len(set(ids)), "Duplicate observation id")
    by_id = {item["id"]: item for item in observations}
    for item in observations:
        for key in ("metric", "unit", "scope", "window", "group"):
            require(bool(item.get(key)), "Observation needs " + key)
        value = item.get("value")
        require(value is None or type(value) in (int, float) and math.isfinite(value) and value >= 0,
                "Observation must be finite and nonnegative, or null")
        require(item.get("confidence") in ("measured", "estimated", "unknown"), "Invalid confidence")
        require((value is None) == (item["confidence"] == "unknown"), "Unknown must have null value")
        require(item.get("coverage") in ("complete", "partial", "unknown"), "Invalid coverage")
        require(bool(item.get("evidence")), "Observation needs evidence")
        require(all(ref in sources for ref in item["evidence"]), "Unknown evidence reference")
        for included in item.get("includes", []):
            require(included in by_id and included != item["id"], "Invalid included observation")
            child = by_id[included]
            require(all(child[key] == item[key] for key in ("metric", "unit", "group", "window")),
                    "Included observations have incompatible accounting boundaries")
        for peer in item.get("disjoint_with", []):
            require(peer in by_id and peer != item["id"], "Invalid disjoint peer")
    def visit(identity, ancestors):
        require(identity not in ancestors, "Cyclic inclusion")
        for child in by_id[identity].get("includes", []):
            visit(child, ancestors | {identity})
    for identity in ids:
        visit(identity, set())
    timeline(record.get("events", []))
    for limit in record.get("limits", []):
        for key in ("metric", "unit", "group", "window"):
            require(bool(limit.get(key)), "Limit needs " + key)
        for key in ("soft_limit", "hard_limit"):
            value = limit.get(key)
            require(value is None or type(value) in (int, float) and math.isfinite(value) and value >= 0,
                    "Invalid limit")
        require(limit.get("soft_limit") is not None or limit.get("hard_limit") is not None, "Empty limit")
        if limit.get("soft_limit") is not None and limit.get("hard_limit") is not None:
            require(limit["soft_limit"] <= limit["hard_limit"], "Soft limit exceeds hard limit")
    seen_traces = set()
    for trace in record.get("legacy_traces", []):
        require(trace.get("source") in sources, "Unknown historical trace source")
        require(trace.get("sha256") == sources[trace["source"]]["sha256"], "Historical trace identity mismatch")
        require(trace["sha256"] not in seen_traces, "Duplicate historical trace")
        seen_traces.add(trace["sha256"])
    assessment = record.get("assessment")
    if assessment:
        for key in ("quality", "use", "effect", "cost_judgment", "comparability", "next_actions"):
            require(bool(assessment.get(key)), "Assessment needs " + key)
        require(bool(assessment.get("evidence")), "Assessment needs evidence references")
        require(all(ref in sources for ref in assessment["evidence"]), "Unknown assessment evidence")
    return record


def totals(record):
    """Only explicitly compatible, disjoint observations may be added."""
    groups = {}
    for item in record.get("observations", []):
        key = (item["group"], item["metric"], item["unit"], item["window"])
        groups.setdefault(key, []).append(item)
    result = []
    for key, items in groups.items():
        included = {child for item in items for child in item.get("includes", [])}
        roots = [item for item in items if item["id"] not in included]
        compatible = all(right["id"] in left.get("disjoint_with", []) and
                         left["id"] in right.get("disjoint_with", [])
                         for index, left in enumerate(roots) for right in roots[index + 1:])
        def descendants(identity):
            by_id = {item["id"]: item for item in items}
            found = {identity}
            for child in by_id[identity].get("includes", []):
                found.update(descendants(child))
            return found
        scopes = [descendants(item["id"]) for item in roots]
        compatible = compatible and all(not left.intersection(right)
                                        for index, left in enumerate(scopes) for right in scopes[index + 1:])
        confidences = {item["confidence"] for item in roots}
        compatible = compatible and len(confidences) == 1
        compatible = compatible and len({item["scope"] for item in roots}) == len(roots)
        known = [item["value"] for item in roots if item["value"] is not None]
        value = sum(known) if compatible and known else None
        status = "partial"
        if not compatible:
            status = "overlap_unresolved"
        elif roots and len(known) == len(roots) and all(item["coverage"] == "complete" for item in roots):
            status = "complete"
        result.append({"group": key[0], "metric": key[1], "unit": key[2], "window": key[3],
                       "confidence": next(iter(confidences)) if len(confidences) == 1 else "mixed",
                       "value": value, "coverage": status,
                       "counted": [item["id"] for item in roots]})
    return result


def summary(record):
    validate(record)
    return {"task_id": record["task"]["id"], "timeline": timeline(record.get("events", [])),
            "resources": totals(record), "legacy_traces": record.get("legacy_traces", []),
            "observed_interval_union": interval_union([timeline(record.get("events", [])),
                                                       *record.get("legacy_traces", [])]),
            "limit_notices": limit_notices(record),
            "assessment": record.get("assessment"),
            "semantic_status": "authored_assessment" if record.get("assessment") else "not_assessed",
            "warning": "Structural validity does not establish quality, causal benefit, or overall efficiency. "
                       "Resource groups, historical windows and elapsed times are not summed across boundaries."}


def limit_notices(record):
    resources = totals(record)
    notices = []
    for limit in record.get("limits", []):
        matching = [item for item in resources if all(item[key] == limit[key]
                    for key in ("metric", "unit", "group", "window"))]
        status = "unmeasured"
        if len(matching) == 1 and matching[0]["value"] is not None:
            value = matching[0]["value"]
            status = "below_observed_threshold"
            if limit.get("hard_limit") is not None and value >= limit["hard_limit"]:
                status = "boundary_reached_follow_host_stop_contract"
            elif limit.get("soft_limit") is not None and value >= limit["soft_limit"]:
                status = "review_increment_and_remaining_scope"
            elif matching[0]["coverage"] != "complete":
                status = "partial_observation_no_budget_clearance"
        notices.append({"metric": limit["metric"], "window": limit["window"], "status": status})
    return notices


def interval_union(traces):
    intervals = sorted((timestamp(item["start"]), timestamp(item["end"]))
                       for trace in traces for item in trace.get("intervals", [])
                       if item["phase"] != "unallocated")
    merged = []
    for start, end in intervals:
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(end, merged[-1][1])
        else:
            merged.append([start, end])
    total = sum((end - start).total_seconds() for start, end in merged)
    raw = sum((end - start).total_seconds() for start, end in intervals)
    return {"classified_boundary_seconds": round(total, 6), "overlap_removed_seconds": round(max(0, raw - total), 6),
            "scope": "Union of classified intervals only. Excludes unallocated gaps and unmeasured tails. "
                     "Not active model time or a whole-task total."}


def render(record):
    validate(record)
    task = record["task"]
    lines = ["# " + task["id"], "", task["purpose"], "", "## 任务与标准", ""]
    for key, label in (("scope", "范围"), ("complexity", "难度来源"),
                       ("quality_floor", "质量底线"), ("result_unit", "结果单位")):
        lines.extend(["- **" + label + "**。" + str(task[key])])
    lines.extend(["", "## 投入观察", "", "| 指标 | 数值 | 单位 | 范围与边界 | 证据 |",
                  "|---|---:|---|---|---|"])
    for item in record.get("observations", []):
        fields = [item["metric"], str(item["value"]) if item["value"] is not None else "unknown",
                  item["unit"], f'{item["scope"]} / {item["window"]} / {item["coverage"]}',
                  ", ".join(item["evidence"])]
        lines.append("| " + " | ".join(field.replace("|", "\\|").replace("\n", " ") for field in fields) + " |")
    assessment = record.get("assessment")
    if assessment:
        for key, label in (("quality", "质量"), ("use", "实际使用"), ("effect", "实际效果"),
                           ("cost_judgment", "成本判断"), ("comparability", "比较边界")):
            lines.extend(["", "## " + label, "", assessment[key]])
        lines.extend(["", "## 后续方向", ""])
        lines.extend("- " + action for action in assessment["next_actions"])
        lines.extend(["", "评价依据为 " + ", ".join(assessment["evidence"]) + "。"])
    else:
        lines.extend(["", "尚未评价质量与效果。"])
    lines.extend(["", "## 证据索引", ""])
    for identity, source in record.get("sources", {}).items():
        lines.append(f'- {identity}。{source["path"]}，{source["locator"]}，SHA256 `{source["sha256"]}`')
    return "\n".join(lines) + "\n"


def add_source(record, path, locator):
    identity = "source-" + str(len(record["sources"]) + 1)
    record["sources"][identity] = {"path": str(path.resolve()), "locator": locator, "sha256": sha256(path)}
    return identity


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("init", "mark", "finish", "observe", "import-research", "check", "summary", "render"))
    parser.add_argument("--record", type=Path, required=True)
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--phase")
    parser.add_argument("--at")
    parser.add_argument("--resumed", action="store_true")
    parser.add_argument("--observation", type=Path)
    parser.add_argument("--trace", type=Path)
    parser.add_argument("--evidence-root", type=Path)
    args = parser.parse_args()
    if args.action in ("check", "summary", "render"):
        record = validate(read(args.record))
        if args.evidence_root:
            for source in record["sources"].values():
                root = args.evidence_root.resolve()
                path = (root / source["path"]).resolve()
                require(path.is_relative_to(root), "Evidence escapes declared root")
                require(sha256(path) == source["sha256"], "Evidence bytes changed: " + str(path))
            for trace in record.get("legacy_traces", []):
                original = read(root / record["sources"][trace["source"]]["path"])
                expected = timeline(original["events"])
                require(all(trace[key] == value for key, value in expected.items()), "Historical summary differs from source")
        if args.action == "render":
            print(render(record), end="")
        elif args.action == "summary":
            print(json.dumps(summary(record), ensure_ascii=False, indent=2))
        else:
            print(json.dumps({"structural_check": "pass", "task_id": record["task"]["id"],
                              "semantic_verdict": "not_provided_by_script"}))
        return
    with writer(args.record):
        if args.action == "init":
            require(not args.record.exists(), "Record already exists")
            require(args.profile is not None, "init needs --profile")
            record = read(args.profile)
            record.setdefault("schema_version", 1)
            record.setdefault("kind", "workflow_cost_effect")
            record.setdefault("mode", "prospective")
            record.setdefault("sources", {})
            record.setdefault("observations", [])
            record.setdefault("events", [])
            require(args.phase or not (args.at or args.resumed), "init timing arguments need --phase")
            if args.phase:
                require(record["mode"] == "prospective", "Historical observations cannot be backdated as live events")
                require(not record["events"], "Initial phase needs an empty timeline")
                record["events"].append({"at": args.at or now(), "phase": args.phase,
                                         "resumed": args.resumed})
        else:
            record = validate(read(args.record))
        if args.action in ("mark", "finish"):
            require(record["mode"] == "prospective", "Historical observations cannot be backdated as live events")
            require(not record["events"] or record["events"][-1]["phase"] is not None, "Record is already finished")
            require(args.action != "mark" or args.phase, "mark needs --phase")
            require(args.action != "finish" or record["events"], "Cannot finish an unstarted timeline")
            record["events"].append({"at": args.at or now(),
                                     "phase": args.phase if args.action == "mark" else None,
                                     "resumed": args.resumed})
        if args.action == "observe":
            require(args.observation is not None, "observe needs --observation")
            record["observations"].append(read(args.observation))
        if args.action == "import-research":
            require(args.trace is not None, "import-research needs --trace")
            trace = read(args.trace)
            require(trace.get("schema_version") == 1 and trace.get("kind") == "research_cost_trace",
                    "Unsupported research trace")
            digest = sha256(args.trace)
            require(not any(item["sha256"] == digest for item in record.get("legacy_traces", [])), "Trace already imported")
            result = timeline(trace["events"])
            source = add_source(record, args.trace, "Original phase boundaries; historical import")
            record.setdefault("legacy_traces", []).append({"source": source, "sha256": digest, **result})
        save(args.record, validate(record))
    result = {"written": str(args.record), "action": args.action}
    if args.action == "init":
        result["timeline_started"] = bool(record["events"])
        result["first_event"] = record["events"][0] if record["events"] else None
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError) as error:
        raise SystemExit(str(error))
