import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("workflow_cost.py")
SPEC = importlib.util.spec_from_file_location("workflow_cost", SCRIPT)
COST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COST)


def record(workflow="research"):
    return {"schema_version": 1, "kind": "workflow_cost_effect", "mode": "prospective",
            "task": {"id": "example", "workflow": workflow, "purpose": "Answer a bounded question",
                     "scope": "One accepted task", "complexity": "Known interface, reversible",
                     "quality_floor": "Host acceptance criteria", "result_unit": "Accepted task"},
            "sources": {"s": {"path": "receipt.json", "locator": "task counter", "sha256": "a" * 64}},
            "observations": [], "events": []}


def observation(identity="parent", value=100, **extra):
    result = {"id": identity, "metric": "goal_tokens", "value": value, "unit": "tokens",
              "scope": identity, "window": "run", "group": "goal-counter", "confidence": "measured",
              "coverage": "complete", "evidence": ["s"]}
    result.update(extra)
    return result


class CostTests(unittest.TestCase):
    def test_workflow_profiles_do_not_share_professional_criteria(self):
        for workflow in ("research", "development", "maintenance", "production"):
            self.assertEqual(COST.validate(record(workflow))["task"]["workflow"], workflow)

    def test_no_automatic_semantic_pass(self):
        self.assertEqual(COST.summary(record())["semantic_status"], "not_assessed")

    def test_timezone_and_chronology(self):
        with self.assertRaises(ValueError):
            COST.timeline([{"at": "2026-11-06T10:00:00", "phase": "work"}])
        with self.assertRaises(ValueError):
            COST.timeline([{"at": "2026-11-06T10:00:00Z", "phase": "work"},
                           {"at": "2026-11-06T09:00:00Z", "phase": None}])

    def test_interruption_is_unallocated(self):
        result = COST.timeline([{"at": "2026-11-06T10:00:00Z", "phase": "analysis"},
                                {"at": "2026-11-06T11:00:00Z", "phase": "review", "resumed": True},
                                {"at": "2026-11-06T11:01:00Z", "phase": None}])
        self.assertEqual(result["phase_seconds"], {"unallocated": 3600, "review": 60})

    def test_unknown_never_becomes_zero(self):
        data = record()
        data["observations"] = [observation(value=None, confidence="unknown")]
        self.assertIsNone(COST.summary(data)["resources"][0]["value"])

    def test_inclusive_parent_is_not_added_to_child(self):
        data = record()
        data["observations"] = [observation(includes=["child"]), observation("child", 40)]
        self.assertEqual(COST.summary(data)["resources"][0]["value"], 100)

    def test_unknown_parent_does_not_disappear(self):
        data = record()
        data["observations"] = [observation(value=None, confidence="unknown", includes=["child"]),
                                observation("child", 40)]
        self.assertIsNone(COST.summary(data)["resources"][0]["value"])

    def test_undeclared_overlap_is_not_summed(self):
        data = record()
        data["observations"] = [observation(), observation("child", 40)]
        total = COST.summary(data)["resources"][0]
        self.assertIsNone(total["value"])
        self.assertEqual(total["coverage"], "overlap_unresolved")

    def test_explicit_disjoint_scopes_can_sum(self):
        data = record()
        data["observations"] = [observation(disjoint_with=["child"]),
                                observation("child", 40, disjoint_with=["parent"])]
        self.assertEqual(COST.summary(data)["resources"][0]["value"], 140)

    def test_shared_descendant_prevents_double_counting(self):
        data = record()
        data["observations"] = [observation(includes=["child"], disjoint_with=["other"]),
                                observation("other", 80, includes=["child"], disjoint_with=["parent"]),
                                observation("child", 40)]
        self.assertIsNone(COST.summary(data)["resources"][0]["value"])

    def test_currencies_and_windows_stay_separate(self):
        data = record()
        data["observations"] = [observation(metric="money", unit="USD"),
                                observation("other", 20, metric="money", unit="CNY"),
                                observation("later", 130, metric="money", unit="USD", window="later")]
        self.assertEqual(len(COST.summary(data)["resources"]), 3)

    def test_cycle_and_invalid_values_rejected(self):
        for value in (-1, float("nan"), float("inf"), True):
            data = record()
            data["observations"] = [observation(value=value)]
            with self.assertRaises(ValueError):
                COST.validate(data)
        data["observations"] = [observation(includes=["child"]), observation("child", includes=["parent"])]
        with self.assertRaises(ValueError):
            COST.validate(data)

    def test_partial_measurement_stays_partial(self):
        data = record()
        data["observations"] = [observation(coverage="partial")]
        self.assertEqual(COST.summary(data)["resources"][0]["coverage"], "partial")

    def test_parallel_intervals_use_union_and_exclude_interruption(self):
        traces = [{"intervals": [{"start": "2026-11-06T10:00:00Z", "end": "2026-11-06T10:02:00Z", "phase": "work"}]},
                  {"intervals": [{"start": "2026-11-06T10:01:00Z", "end": "2026-11-06T10:03:00Z", "phase": "review"},
                                 {"start": "2026-11-06T10:03:00Z", "end": "2026-11-06T11:00:00Z", "phase": "unallocated"}]}]
        result = COST.interval_union(traces)
        self.assertEqual(result["classified_boundary_seconds"], 180)
        self.assertEqual(result["overlap_removed_seconds"], 60)

    def test_missing_evidence_rejected(self):
        data = record()
        data["observations"] = [observation(evidence=["missing"])]
        with self.assertRaises(ValueError):
            COST.validate(data)

    def test_limits_use_same_accounting_window_and_keep_unknown(self):
        data = record()
        data["limits"] = [{"metric": "goal_tokens", "unit": "tokens", "group": "goal-counter",
                           "window": "run", "soft_limit": 80, "hard_limit": 120}]
        self.assertEqual(COST.summary(data)["limit_notices"][0]["status"], "unmeasured")
        data["observations"] = [observation()]
        self.assertEqual(COST.summary(data)["limit_notices"][0]["status"], "review_increment_and_remaining_scope")
        data["observations"][0]["value"] = 125
        self.assertEqual(COST.summary(data)["limit_notices"][0]["status"], "boundary_reached_follow_host_stop_contract")
        data["observations"][0]["window"] = "another-run"
        self.assertEqual(COST.summary(data)["limit_notices"][0]["status"], "unmeasured")

    def test_no_budget_clearance_from_partial_reading(self):
        data = record()
        data["observations"] = [observation(value=10, coverage="partial")]
        data["limits"] = [{"metric": "goal_tokens", "unit": "tokens", "group": "goal-counter", "window": "run", "hard_limit": 120}]
        self.assertEqual(COST.summary(data)["limit_notices"][0]["status"], "partial_observation_no_budget_clearance")

    def test_lock_and_atomic_failure_preserve_record(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "run.json"
            original = record()
            with COST.writer(path):
                COST.save(path, original)
                with self.assertRaises(FileExistsError):
                    with COST.writer(path):
                        pass
            with COST.writer(path):
                with self.assertRaises(ValueError):
                    COST.save(path, {"invalid": float("nan")})
            self.assertEqual(COST.read(path), original)

    def test_cli_normal_entrypoints_and_repeated_import(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            path = folder / "run.json"
            profile = folder / "profile.json"
            profile.write_text(json.dumps(record()), encoding="utf-8")
            def call(*args):
                return subprocess.run([sys.executable, "-X", "utf8", "-B", str(SCRIPT), *args, "--record", str(path)],
                                      capture_output=True, text=True, encoding="utf-8")
            for args in [("init", "--profile", str(profile)),
                         ("mark", "--phase", "implementation", "--at", "2026-11-06T10:00:00Z"),
                         ("finish", "--at", "2026-11-06T10:01:00Z"), ("summary",), ("render",)]:
                result = call(*args)
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotEqual(call("mark", "--phase", "later").returncode, 0)
            trace = folder / "legacy.json"
            trace.write_text(json.dumps({"schema_version": 1, "kind": "research_cost_trace",
                                         "events": [{"at": "2026-11-06T10:00:00Z", "phase": "discovery"},
                                                    {"at": "2026-11-06T10:02:00Z", "phase": None}]}), encoding="utf-8")
            self.assertEqual(call("import-research", "--trace", str(trace)).returncode, 0)
            self.assertNotEqual(call("import-research", "--trace", str(trace)).returncode, 0)

    def test_retrospective_does_not_allow_fabricated_live_events(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "record.json"
            data = record()
            data["mode"] = "retrospective"
            path.write_text(json.dumps(data), encoding="utf-8")
            result = subprocess.run([sys.executable, "-X", "utf8", "-B", str(SCRIPT), "mark", "--record", str(path),
                                     "--phase", "work"], capture_output=True)
            self.assertNotEqual(result.returncode, 0)

    def test_init_reports_and_persists_first_event(self):
        for phase in (None, "read-and-author"):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as directory:
                folder = Path(directory)
                profile = folder / "profile.json"
                path = folder / "run.json"
                profile.write_text(json.dumps(record()), encoding="utf-8")
                args = ["--phase", phase, "--at", "2026-11-06T10:00:00Z"] if phase else []
                result = subprocess.run([sys.executable, "-X", "utf8", "-B", str(SCRIPT), "init",
                                         "--profile", str(profile), "--record", str(path), *args],
                                        capture_output=True, text=True, encoding="utf-8")
                self.assertEqual(result.returncode, 0, result.stderr)
                output = json.loads(result.stdout)
                events = COST.read(path)["events"]
                self.assertEqual(output["timeline_started"], phase is not None)
                self.assertEqual(output["first_event"], events[0] if phase else None)
                self.assertEqual(events, [{"at": "2026-11-06T10:00:00Z", "phase": phase,
                                           "resumed": False}] if phase else [])

    def test_invalid_init_timing_leaves_no_record(self):
        cases = [("prospective", [], ["--at", "2026-11-06T10:00:00Z"]),
                 ("prospective", [], ["--resumed"]),
                 ("retrospective", [], ["--phase", "work"]),
                 ("prospective", [{"at": "2026-11-06T09:00:00Z", "phase": "earlier"}],
                  ["--phase", "work"]),
                 ("prospective", [], ["--phase", "work", "--at", "invalid"])]
        for mode, events, args in cases:
            with self.subTest(mode=mode, args=args), tempfile.TemporaryDirectory() as directory:
                folder = Path(directory)
                profile = folder / "profile.json"
                path = folder / "run.json"
                data = record()
                data.update(mode=mode, events=events)
                profile.write_text(json.dumps(data), encoding="utf-8")
                result = subprocess.run([sys.executable, "-X", "utf8", "-B", str(SCRIPT), "init",
                                         "--profile", str(profile), "--record", str(path), *args],
                                        capture_output=True, text=True, encoding="utf-8")
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(path.exists())
                self.assertFalse(path.with_name(path.name + ".lock").exists())


if __name__ == "__main__":
    unittest.main()
