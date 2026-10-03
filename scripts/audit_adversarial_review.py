#!/usr/bin/env python3
"""Read-only follow-up audit for adversarial-review skill loads.

Scans local Copilot CLI session logs and compares real loads after the
current skill text first appeared against the thresholds in a baseline file.
Exit codes: 0 pass, 1 fail, 2 pending (not enough loads yet).
"""

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SKILL_NAME = "adversarial-review"
LOADERS = {"skill", "m_get_skill"}
UPDATED = re.compile(r"(?m)^Updated: (.+?)\s*$")
FRESH = re.compile(r"^\W*Adversarial review \| Updated: (.+?)[\s*_`]*$", re.M)
PATH_LINE = re.compile(r"(?mi)^[\s>*_`-]*execution path[*_`]*:(.*)$")
PREMORTEM_LINE = re.compile(r"(?mi)^[\s>*_`-]*premortem[*_`]*:")


def skill_body(text):
    """Body the runtime loads: text after the frontmatter, leading whitespace removed."""
    if text.startswith("---\n"):
        text = text.split("---\n", 2)[2]
    return text.lstrip()


def skill_content_hash(text):
    return hashlib.sha256(skill_body(text).encode()).hexdigest()


def skill_updated(body):
    match = UPDATED.search(body or "")
    return match.group(1) if match else None


def is_skill(name):
    return (name or "").split(":")[-1] == SKILL_NAME


def read_events(path):
    with path.open("rb") as stream:
        for line in stream:
            try:
                yield json.loads(line)
            except ValueError:
                continue


def scan(state_dir, excluded):
    """Return deduplicated load records and per-session events for sessions with loads."""
    loads = {}
    sessions = {}
    for path in sorted(Path(state_dir).glob("*/events.jsonl")):
        sid = path.parent.name
        if sid in excluded or SKILL_NAME.encode() not in path.read_bytes():
            continue
        events = list(read_events(path))
        sessions[sid] = events
        done = {}
        for e in events:
            if e.get("type") == "tool.execution_complete":
                done[e.get("data", {}).get("toolCallId")] = e
        children = defaultdict(list)
        for e in events:
            if e.get("type") in ("skill.invoked", "skill.invoked_ref"):
                children[e.get("parentId")].append(e)
        for i, e in enumerate(events):
            data = e.get("data", {})
            kind = e.get("type")
            record = None
            if kind == "tool.execution_start" and data.get("toolName") in LOADERS:
                args = data.get("arguments") or {}
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except ValueError:
                        args = {}
                if not is_skill(args.get("skill") or args.get("name")):
                    continue
                call = data.get("toolCallId")
                finish = done.get(call)
                skill_events = children.get(finish["id"], []) if finish else []
                record = {"key": call, "ok": bool(finish and finish["data"].get("success")),
                          "skill_event": skill_events[0] if skill_events else None}
            elif kind in ("skill.invoked", "skill.invoked_ref") and is_skill(data.get("name")) \
                    and data.get("trigger") == "user-invoked":
                record = {"key": e["id"], "ok": True, "skill_event": e, "slash": True}
            if record is None or record["key"] in loads:
                continue
            record.update(session=sid, index=i, timestamp=e.get("timestamp", ""),
                          agent=e.get("agentId"))
            loads[record["key"]] = record
    return loads, sessions


def describe(record, labels):
    event = record["skill_event"]
    if not event:
        return None, None
    data = event.get("data", {})
    if "content" in data:
        content = data["content"]
        digest = hashlib.sha256(content.encode()).hexdigest()
        labels.setdefault(digest, skill_updated(content))
        return digest, labels[digest]
    digest = (data.get("contentId") or "").split(":")[-1] or None
    return digest, labels.get(digest)


def turn_of(record, events):
    """Main-thread turn number; a slash-command load belongs to the user message after it."""
    before = sum(1 for e in events[:record["index"]]
                 if e.get("type") == "user.message" and not e.get("agentId"))
    return before + 1 if record.get("slash") else before


def turn_messages(events, turn, after):
    """Main assistant messages in the turn that come after event index `after`."""
    count = 0
    messages = []
    for i, e in enumerate(events):
        if e.get("agentId"):
            continue
        if e.get("type") == "user.message":
            count += 1
            if count > turn:
                break
        elif count == turn and i > after and e.get("type") == "assistant.message":
            text = (e.get("data", {}).get("content") or "").strip()
            if text:
                messages.append(text)
    return messages


def ratio(part, whole):
    return round(part / whole, 4) if whole else None


def audit(state_dir, baseline, skill_text):
    expected_hash = skill_content_hash(skill_text)
    expected_updated = skill_updated(skill_body(skill_text))
    loads, sessions = scan(state_dir, set(baseline.get("exclude_sessions", [])))
    labels = {expected_hash: expected_updated}
    for record in loads.values():
        record["hash"], record["updated"] = None, None
        if record["ok"]:
            record["hash"], record["updated"] = describe(record, labels)
    for record in loads.values():
        if record["hash"] and record["updated"] is None:
            record["updated"] = labels.get(record["hash"])
    ordered = sorted(loads.values(), key=lambda r: r["timestamp"])
    start = baseline.get("window_start", "first-expected-load")
    if start == "first-expected-load":
        start = next((r["timestamp"] for r in ordered if r["hash"] == expected_hash), None)
    window = [r for r in ordered if start and r["timestamp"] >= start]
    ok = [r for r in window if r["ok"]]
    main = [r for r in ok if not r["agent"]]
    turns = defaultdict(list)
    for record in main:
        turns[(record["session"], turn_of(record, sessions[record["session"]]))].append(record)
    disclosed = fresh = 0
    for (sid, turn), records in turns.items():
        first = min(records, key=lambda r: r["index"])
        date = first["updated"] or expected_updated
        messages = turn_messages(sessions[sid], turn, first["index"])
        if not messages:
            continue
        paths = PATH_LINE.findall(messages[-1])
        if any(f"Updated: {date}" in p for p in paths) and PREMORTEM_LINE.search(messages[-1]):
            disclosed += 1
        banner = FRESH.match(messages[0].splitlines()[0])
        if banner and banner.group(1) == date:
            fresh += 1
    hashes = Counter(r["hash"] or "unknown" for r in ok)
    metrics = {
        "window_start": start,
        "loads_total": len(window),
        "loads_success": len(ok),
        "loads_failed": len(window) - len(ok),
        "subagent_loads": len(ok) - len(main),
        "subagent_share": ratio(len(ok) - len(main), len(ok)),
        "main_turns": len(turns),
        "duplicate_turns": sum(1 for v in turns.values() if len(v) > 1),
        "disclosed_turns": disclosed,
        "disclosure_rate": ratio(disclosed, len(turns)),
        "fresh_first_turns": fresh,
        "freshness_rate": ratio(fresh, len(turns)),
        "content_hashes": dict(hashes),
        "updated_labels": dict(Counter(r["updated"] or "none" for r in ok)),
        "expected_hash_share": ratio(hashes.get(expected_hash, 0), len(ok)),
        "sessions": len({r["session"] for r in window}),
    }
    result = {"expected": {"content_hash": expected_hash, "updated": expected_updated},
              "metrics": metrics, "checks": {}}
    need = baseline.get("min_loads", 50)
    if not start:
        result.update(status="pending", reason="the expected skill text has not been loaded yet")
        return result
    if len(ok) < need:
        result.update(status="pending", reason=f"{len(ok)} of {need} successful loads since {start}")
        return result
    t = baseline["thresholds"]
    checks = {
        "subagent_share": metrics["subagent_share"] < t["max_subagent_share"],
        "disclosure_rate": (metrics["disclosure_rate"] or 0) > t["min_disclosure_rate"],
        "freshness_rate": (metrics["freshness_rate"] or 0) > t["min_freshness_rate"],
        "duplicate_turns": metrics["duplicate_turns"] <= t["max_duplicate_turns"],
        "expected_hash_share": metrics["expected_hash_share"] >= t["min_expected_hash_share"],
    }
    result.update(checks=checks, status="pass" if all(checks.values()) else "fail",
                  reason=f"{len(ok)} successful loads since {start}")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", default=str(Path.home() / ".copilot" / "session-state"))
    parser.add_argument("--baseline", default=str(ROOT / "scripts" / "adversarial-review-audit-baseline.json"))
    parser.add_argument("--skill", default=str(ROOT / "skills" / SKILL_NAME / "SKILL.md"))
    parser.add_argument("--json", action="store_true", help="print the full result as JSON")
    args = parser.parse_args(argv)
    baseline = json.loads(Path(args.baseline).read_text())
    result = audit(args.state_dir, baseline, Path(args.skill).read_text())
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        m = result["metrics"]
        print(f"status: {result['status']} ({result['reason']})")
        print(f"expected: Updated {result['expected']['updated']}, sha256 {result['expected']['content_hash'][:12]}")
        for key in ("loads_success", "subagent_share", "disclosure_rate", "freshness_rate",
                    "duplicate_turns", "expected_hash_share"):
            print(f"{key}: {m[key]}")
    return {"pass": 0, "fail": 1}.get(result["status"], 2)


if __name__ == "__main__":
    sys.exit(main())
