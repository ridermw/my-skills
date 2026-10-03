"""Regression tests for scripts/audit_adversarial_review.py."""

import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "audit_adversarial_review.py"


def load_module():
    spec = importlib.util.spec_from_file_location("audit_adversarial_review", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SKILL = """---
name: adversarial-review
description: 'Use when testing.'
---

# Adversarial Review

Updated: October 3, 2026

Body text.
"""
BODY = SKILL.split("---\n", 2)[2].lstrip()
EXPECTED_HASH = hashlib.sha256(BODY.encode()).hexdigest()
OLD_BODY = "# Adversarial Review\n\nOld body.\n"
OLD_HASH = hashlib.sha256(OLD_BODY.encode()).hexdigest()


class Session:
    def __init__(self, root, sid, start="2026-10-04T00:00:00Z"):
        self.path = Path(root) / sid / "events.jsonl"
        self.path.parent.mkdir(parents=True)
        self.events = []
        self.n = 0
        self.add("session.start", {"sessionId": sid}, ts=start)

    def add(self, kind, data, agent=None, parent=None, ts=None, eid=None):
        self.n += 1
        event = {"type": kind, "data": data, "id": eid or f"{self.path.parent.name}-{self.n}",
                 "timestamp": ts or f"2026-10-04T00:{self.n // 60:02d}:{self.n % 60:02d}Z",
                 "parentId": parent}
        if agent:
            event["agentId"] = agent
        self.events.append(event)
        return event["id"]

    def user(self, text="review this", agent=None):
        return self.add("user.message", {"content": text}, agent=agent)

    def say(self, text, agent=None):
        return self.add("assistant.message", {"content": text}, agent=agent)

    def agent_load(self, call, body=BODY, agent=None, success=True):
        self.add("tool.execution_start", {"toolCallId": call, "toolName": "skill",
                                          "arguments": {"skill": "adversarial-review"}}, agent=agent)
        done = self.add("tool.execution_complete", {"toolCallId": call, "success": success}, agent=agent)
        if success:
            self.add("skill.invoked", {"name": "adversarial-review", "content": body,
                                       "trigger": "agent-invoked"}, agent=agent, parent=done)

    def slash_load(self, body=BODY):
        self.add("skill.invoked", {"name": "adversarial-review", "content": body,
                                   "trigger": "user-invoked"})

    def write(self):
        self.path.write_text("".join(json.dumps(e) + "\n" for e in self.events))


DISCLOSED = "Adversarial review | Updated: October 3, 2026\nExecution path: parallel-subagents (adversarial-review, Updated: October 3, 2026)\n**Premortem:** a stale cache leaks data."


def baseline(**overrides):
    data = {"schema": 1, "window_start": "first-expected-load", "min_loads": 2,
            "thresholds": {"subagent_share_below": 0.10, "disclosure_rate_above": 0.90,
                           "freshness_rate_above": 0.90,
                           "duplicate_turns_at_most": 0, "expected_hash_share_at_least": 1.0},
            "exclude_sessions": []}
    data.update(overrides)
    return data


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.audit = load_module()
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def run_audit(self, base=None):
        return self.audit.audit(self.root, base or baseline(), SKILL)

    def test_content_hash_matches_runtime_body_normalization(self):
        self.assertEqual(self.audit.skill_content_hash(SKILL), EXPECTED_HASH)

    def test_updated_label_is_read_from_loaded_body(self):
        self.assertEqual(self.audit.skill_updated(BODY), "October 3, 2026")
        self.assertIsNone(self.audit.skill_updated(OLD_BODY))

    def test_forked_copy_of_one_load_counts_once(self):
        for sid in ("a", "fork"):
            s = Session(self.root, sid)
            s.user()
            s.agent_load("call-1")
            s.say(DISCLOSED)
            s.write()
        self.assertEqual(self.run_audit()["metrics"]["loads_success"], 1)

    def test_subagent_share_uses_successful_loads(self):
        s = Session(self.root, "a")
        s.user()
        s.agent_load("call-1")
        s.agent_load("call-2", agent="reviewer-1")
        s.agent_load("call-3", agent="reviewer-2", success=False)
        s.say(DISCLOSED)
        s.write()
        m = self.run_audit()["metrics"]
        self.assertEqual((m["loads_success"], m["loads_failed"], m["subagent_loads"]), (2, 1, 1))
        self.assertEqual(m["subagent_share"], 0.5)

    def test_slash_command_followed_by_agent_load_is_a_duplicate_turn(self):
        s = Session(self.root, "a")
        s.slash_load()
        s.user("/adversarial-review plan.md")
        s.agent_load("call-1")
        s.say(DISCLOSED)
        s.user("next")
        s.agent_load("call-2")
        s.say(DISCLOSED)
        s.write()
        m = self.run_audit()["metrics"]
        self.assertEqual((m["main_turns"], m["duplicate_turns"]), (2, 1))

    def test_disclosure_needs_execution_path_and_premortem_in_final_message(self):
        s = Session(self.root, "a")
        s.user()
        s.agent_load("call-1")
        s.say(DISCLOSED)
        s.user("again")
        s.agent_load("call-2")
        s.say("Execution path: single-agent\nNo premortem here.")
        s.write()
        m = self.run_audit()["metrics"]
        self.assertEqual((m["disclosed_turns"], m["main_turns"]), (1, 2))
        self.assertEqual(m["disclosure_rate"], 0.5)

    def test_window_starts_at_first_load_of_expected_text(self):
        s = Session(self.root, "a")
        s.user()
        s.agent_load("old", body=OLD_BODY)
        s.say("old answer")
        s.user()
        s.agent_load("new")
        s.say(DISCLOSED)
        s.user()
        s.agent_load("drift", body=OLD_BODY)
        s.say(DISCLOSED)
        s.write()
        result = self.run_audit()
        m = result["metrics"]
        self.assertEqual(m["loads_success"], 2)
        self.assertEqual(m["content_hashes"], {EXPECTED_HASH: 1, OLD_HASH: 1})
        self.assertEqual(m["updated_labels"], {"October 3, 2026": 1, "none": 1})
        self.assertEqual(m["expected_hash_share"], 0.5)

    def test_excluded_sessions_are_ignored(self):
        s = Session(self.root, "verify")
        s.user()
        s.agent_load("call-1")
        s.write()
        result = self.run_audit(baseline(exclude_sessions=["verify"]))
        self.assertEqual(result["status"], "pending")
        self.assertEqual(result["metrics"]["loads_success"], 0)

    def test_excluded_load_copied_into_a_fork_stays_excluded(self):
        for sid, calls in (("verify", ["call-1"]), ("fork", ["call-1", "call-2"])):
            s = Session(self.root, sid)
            for call in calls:
                s.user()
                s.agent_load(call)
                s.say(DISCLOSED)
            s.write()
        m = self.run_audit(baseline(exclude_sessions=["verify"]))["metrics"]
        self.assertEqual(m["loads_success"], 1)

    def test_status_is_pending_below_threshold_load_count(self):
        s = Session(self.root, "a")
        s.user()
        s.agent_load("call-1")
        s.say(DISCLOSED)
        s.write()
        result = self.run_audit()
        self.assertEqual(result["status"], "pending")
        self.assertIn("1 of 2", result["reason"])

    def test_status_passes_or_fails_after_threshold_load_count(self):
        s = Session(self.root, "a")
        for call in ("call-1", "call-2"):
            s.user()
            s.agent_load(call)
            s.say(DISCLOSED)
        s.write()
        self.assertEqual(self.run_audit()["status"], "pass")
        s.agent_load("call-3", agent="reviewer")
        s.write()
        result = self.run_audit()
        self.assertEqual(result["status"], "fail")
        self.assertFalse(result["checks"]["subagent_share"])

    def test_freshness_line_must_open_the_first_answer_after_load(self):
        s = Session(self.root, "a")
        s.user()
        s.agent_load("call-1")
        s.say("Adversarial review | Updated: October 3, 2026\nMode: Rubber Duck")
        s.say(DISCLOSED)
        s.user("again")
        s.agent_load("call-2")
        s.say("Mode: Rubber Duck first")
        s.say("Adversarial review | Updated: October 3, 2026\n" + DISCLOSED)
        s.write()
        m = self.run_audit()["metrics"]
        self.assertEqual((m["fresh_first_turns"], m["main_turns"]), (1, 2))
        self.assertEqual(m["freshness_rate"], 0.5)

    def test_freshness_uses_first_answer_after_the_load_not_before_it(self):
        s = Session(self.root, "a")
        s.user()
        s.say("I will load the review skill.")
        s.agent_load("call-1")
        s.say(DISCLOSED)
        s.write()
        self.assertEqual(self.run_audit()["metrics"]["fresh_first_turns"], 1)

    def test_banner_and_path_line_must_carry_the_loaded_updated_date(self):
        s = Session(self.root, "a")
        s.user()
        s.agent_load("call-1")
        s.say(DISCLOSED.replace("October 3, 2026", "July 16, 2026"))
        s.write()
        m = self.run_audit()["metrics"]
        self.assertEqual((m["fresh_first_turns"], m["disclosed_turns"]), (0, 0))

    def test_reference_only_load_keeps_the_expected_updated_label(self):
        s = Session(self.root, "a")
        s.user()
        s.add("tool.execution_start", {"toolCallId": "call-1", "toolName": "skill",
                                       "arguments": {"skill": "adversarial-review"}})
        done = s.add("tool.execution_complete", {"toolCallId": "call-1", "success": True})
        s.add("skill.invoked_ref", {"name": "adversarial-review", "contentId": "sha256:" + EXPECTED_HASH,
                                    "trigger": "agent-invoked"}, parent=done)
        s.say(DISCLOSED)
        s.write()
        m = self.run_audit()["metrics"]
        self.assertEqual(m["updated_labels"], {"October 3, 2026": 1})
        self.assertEqual(m["expected_hash_share"], 1.0)

    def test_load_without_a_known_updated_date_gets_no_credit(self):
        s = Session(self.root, "a")
        s.user()
        s.agent_load("new")
        s.say(DISCLOSED)
        s.user()
        s.agent_load("stale", body=OLD_BODY)
        s.say(DISCLOSED)
        s.write()
        m = self.run_audit()["metrics"]
        self.assertEqual((m["fresh_first_turns"], m["disclosed_turns"], m["main_turns"]), (1, 1, 2))

    def test_thresholds_are_strict_at_the_user_limits(self):
        s = Session(self.root, "a")
        for n in range(9):
            s.user()
            s.agent_load(f"call-{n}")
            s.say(DISCLOSED)
        s.agent_load("reviewer-load", agent="reviewer")
        s.write()
        result = self.run_audit(baseline(min_loads=10))
        self.assertEqual(result["metrics"]["subagent_share"], 0.1)
        self.assertFalse(result["checks"]["subagent_share"])

    def test_strict_checks_use_unrounded_ratios(self):
        s = Session(self.root, "a")
        s.user()
        s.agent_load("call-1")
        s.say(DISCLOSED)
        s.agent_load("call-2", agent="reviewer-1")
        s.agent_load("call-3", agent="reviewer-2")
        s.write()
        base = baseline(min_loads=3)
        base["thresholds"]["subagent_share_below"] = 0.6667
        self.assertTrue(self.run_audit(base)["checks"]["subagent_share"])

    def test_cli_exit_codes_and_read_only_output(self):
        s = Session(self.root, "a")
        s.user()
        s.agent_load("call-1")
        s.write()
        before = s.path.read_bytes()
        base = self.root / "baseline.json"
        base.write_text(json.dumps(baseline()))
        skill = self.root / "SKILL.md"
        skill.write_text(SKILL)
        with contextlib.redirect_stdout(io.StringIO()) as out:
            code = self.audit.main(["--state-dir", str(self.root), "--baseline", str(base),
                                    "--skill", str(skill), "--json"])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(out.getvalue())["status"], "pending")
        self.assertEqual(s.path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
