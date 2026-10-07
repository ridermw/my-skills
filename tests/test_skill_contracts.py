"""Exercise the shipped shell examples against isolated, local-only fixtures."""

import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


def shell_example(skill, start):
    text = (ROOT / "skills" / skill / "SKILL.md").read_text()
    examples = re.findall(r"```bash\n(.*?)\n```", text, re.S)
    return next(example for example in examples if example.startswith(start))


class IsolatedFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="my-skills-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.env = {
            key: value for key, value in os.environ.items()
            if not key.startswith("GIT_")
        }
        self.env.update({
            "HOME": str(self.home),
            "XDG_CONFIG_HOME": str(self.home / ".config"),
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_TERMINAL_PROMPT": "0",
            "PROJECT_ROOMS_DIR": "",
        })
        self.hooks = self.root / "empty-hooks"
        self.hooks.mkdir()

    def git(self, directory, *args):
        result = subprocess.run(
            [
                "git", "-c", f"core.hooksPath={self.hooks}",
                "-c", "commit.gpgsign=false",
                "-c", "user.name=Skill Fixture",
                "-c", "user.email=fixture@example.invalid",
                "-C", str(directory), *args,
            ],
            env=self.env, text=True, capture_output=True, timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def shell(self, script, *args):
        return subprocess.run(
            ["bash", "-c", script, "skill-example", *map(str, args)],
            cwd=self.root, env=self.env, text=True, capture_output=True,
            timeout=30,
        )


class SyncReposTests(IsolatedFixture):
    def setUp(self):
        super().setUp()
        self.script = shell_example("sync-repos", "ROOT=")
        self.origin = self.root / "origin.git"
        self.seed = self.root / "seed"
        self.repo = self.root / "clone"
        self.git(self.root, "init", "--bare", "--initial-branch=main", self.origin)
        self.git(self.root, "init", "--initial-branch=main", self.seed)
        self.commit(self.seed, "initial")
        self.git(self.seed, "remote", "add", "origin", self.origin)
        self.git(self.seed, "push", "--quiet", "origin", "main")
        self.git(self.root, "clone", "--quiet", self.origin, self.repo)
        self.original = self.git(self.repo, "rev-parse", "HEAD")

    def commit(self, directory, content):
        (directory / "fixture.txt").write_text(content + "\n")
        self.git(directory, "add", "fixture.txt")
        self.git(
            directory, "commit", "--quiet", "-m", content,
            "-m", "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>",
        )
        return self.git(directory, "rev-parse", "HEAD")

    def advance(self):
        tip = self.commit(self.seed, "remote advance")
        self.git(self.seed, "push", "--quiet", "origin", "main")
        return tip

    def sync(self, scope="current-branch"):
        result = self.shell(self.script, self.repo, scope)
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = result.stdout.strip().splitlines()
        self.assertEqual(len(rows), 1, result.stdout)
        return rows[0].split("\t", 2)[2]

    def change_after_remote_read(self, change):
        self.script = """
git() {
  local rc
  command git "$@"
  rc=$?
  if [ "${3:-}" = ls-remote ] && [ "$rc" -eq 0 ]; then
    """ + change + """
    rc=$?
  fi
  return "$rc"
}
""" + self.script

    def test_current_branch_advances(self):
        tip = self.advance()
        self.assertEqual(self.sync(), "advanced 1 commits")
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), tip)

    def test_up_to_date_is_distinct_from_advanced(self):
        self.assertEqual(self.sync(), "up-to-date")

    def test_dirty_checkout_is_preserved(self):
        self.advance()
        (self.repo / "fixture.txt").write_text("unsaved user work\n")
        self.assertEqual(self.sync(), "dirty (skipped), 1 behind")
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), self.original)
        self.assertEqual((self.repo / "fixture.txt").read_text(), "unsaved user work\n")

    def test_stderr_diagnostic_does_not_make_a_clean_checkout_dirty(self):
        tip = self.advance()
        self.git(self.repo, "config", "core.fsmonitor", self.root / "missing-fsmonitor-hook")
        status = subprocess.run(
            ["git", "-C", str(self.repo), "status", "--porcelain"],
            env=self.env, text=True, capture_output=True, timeout=15,
        )
        self.assertEqual(status.returncode, 0, status.stderr)
        self.assertEqual(status.stdout, "")
        self.assertTrue(status.stderr, "fixture must produce a real Git diagnostic")
        self.assertEqual(self.sync(), "advanced 1 commits")
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), tip)

    def test_real_divergence_is_reported_without_mutation(self):
        local = self.commit(self.repo, "local change")
        self.advance()
        self.assertEqual(self.sync(), "diverged (needs manual merge)")
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), local)

    def test_upstream_remote_name_can_contain_slashes(self):
        self.git(self.repo, "remote", "add", "team/upstream", self.origin)
        self.git(self.repo, "fetch", "--quiet", "team/upstream")
        self.git(self.repo, "branch", "--set-upstream-to=team/upstream/main", "main")
        tip = self.advance()
        self.assertEqual(self.sync(), "advanced 1 commits")
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), tip)

    def test_local_upstream_is_not_fetched_as_a_remote(self):
        self.git(self.repo, "switch", "--quiet", "-c", "feature")
        self.git(self.repo, "branch", "--set-upstream-to=main", "feature")
        tip = self.advance()
        self.git(self.repo, "fetch", "--quiet", "origin")
        self.git(self.repo, "branch", "-f", "main", "origin/main")
        self.assertEqual(self.sync(), "advanced 1 commits")
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), tip)

    def test_unused_broken_remote_does_not_block_sync(self):
        self.git(self.repo, "remote", "add", "unused", self.root / "absent.git")
        self.advance()
        self.assertEqual(self.sync(), "advanced 1 commits")

    def test_clean_default_scope_does_not_fetch_unused_feature_upstream(self):
        self.git(self.repo, "switch", "--quiet", "-c", "feature")
        self.git(self.repo, "remote", "add", "upstream", self.origin)
        self.git(self.repo, "fetch", "--quiet", "upstream")
        self.git(self.repo, "branch", "--set-upstream-to=upstream/main", "feature")
        self.git(self.repo, "remote", "set-url", "upstream", self.root / "absent.git")
        tip = self.advance()
        self.assertEqual(self.sync("default-branch"), "advanced 1 commits (on feature)")
        self.assertEqual(self.git(self.repo, "rev-parse", "main"), tip)

    def test_remote_default_change_does_not_update_the_old_default(self):
        self.git(self.repo, "switch", "--quiet", "-c", "feature")
        self.advance()
        self.git(self.seed, "switch", "--quiet", "-c", "trunk")
        tip = self.commit(self.seed, "new default")
        self.git(self.seed, "push", "--quiet", "origin", "trunk")
        self.git(self.root, "--git-dir", self.origin, "symbolic-ref", "HEAD", "refs/heads/trunk")
        self.assertEqual(self.sync("default-branch"), "created local trunk (on feature)")
        self.assertEqual(self.git(self.repo, "rev-parse", "trunk"), tip)
        self.assertEqual(self.git(self.repo, "rev-parse", "main"), self.original)
        self.assertEqual(self.git(self.repo, "branch", "--show-current"), "feature")

    def test_current_scope_does_not_require_a_discoverable_default(self):
        tip = self.advance()
        self.git(self.seed, "push", "--quiet", "origin", "main:topic")
        self.git(self.repo, "fetch", "--quiet", "origin")
        self.git(self.repo, "branch", "--set-upstream-to=origin/topic", "main")
        self.git(self.repo, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD")
        self.git(self.root, "--git-dir", self.origin, "symbolic-ref", "HEAD", "refs/heads/missing")
        self.git(self.root, "--git-dir", self.origin, "update-ref", "-d", "refs/heads/main")
        self.assertEqual(self.sync(), "advanced 1 commits")
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), tip)

    def test_current_branch_rejects_stale_fetch_filtered_upstream(self):
        self.git(self.repo, "config", "--add", "remote.origin.fetch", "^refs/heads/main")
        filters = self.git(self.repo, "config", "--get-all", "remote.origin.fetch")
        self.advance()
        result = self.sync()
        self.assertIn("error:", result)
        self.assertIn("stale", result)
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), self.original)
        self.assertEqual(self.git(self.repo, "rev-parse", "origin/main"), self.original)
        self.assertEqual(self.git(self.repo, "config", "--get-all", "remote.origin.fetch"), filters)

    def test_default_branch_rejects_stale_fetch_filtered_default(self):
        self.git(self.seed, "push", "--quiet", "origin", "main:other")
        self.git(
            self.repo, "config", "--replace-all", "remote.origin.fetch",
            "+refs/heads/other:refs/remotes/origin/other",
        )
        self.git(self.repo, "switch", "--quiet", "-c", "feature")
        self.advance()
        result = self.sync("default-branch")
        self.assertIn("error:", result)
        self.assertIn("stale", result)
        self.assertEqual(self.git(self.repo, "rev-parse", "main"), self.original)
        self.assertEqual(self.git(self.repo, "rev-parse", "origin/main"), self.original)
        self.assertEqual(self.git(self.repo, "branch", "--show-current"), "feature")

    def test_dirty_count_rejects_stale_fetch_filtered_upstream(self):
        self.git(self.repo, "config", "--add", "remote.origin.fetch", "^refs/heads/main")
        self.advance()
        (self.repo / "fixture.txt").write_text("unsaved user work\n")
        for scope in ("current-branch", "default-branch"):
            with self.subTest(scope=scope):
                result = self.sync(scope)
                self.assertIn("error:", result)
                self.assertIn("stale", result)
                self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), self.original)
                self.assertEqual((self.repo / "fixture.txt").read_text(), "unsaved user work\n")

    def test_configured_upstream_excluded_by_fetch_mapping_is_an_error(self):
        self.git(self.seed, "push", "--quiet", "origin", "main:other")
        self.git(
            self.repo, "config", "--replace-all", "remote.origin.fetch",
            "+refs/heads/other:refs/remotes/origin/other",
        )
        self.advance()
        self.assertIn("error:", self.sync())
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), self.original)

    def test_dirty_default_scope_ignores_unselected_stale_default(self):
        self.git(self.seed, "push", "--quiet", "origin", "main:topic")
        self.git(self.repo, "fetch", "--quiet", "origin")
        self.git(self.repo, "switch", "--quiet", "-c", "feature")
        self.git(self.repo, "branch", "--set-upstream-to=origin/topic", "feature")
        self.git(self.repo, "config", "--add", "remote.origin.fetch", "^refs/heads/main")
        self.advance()
        (self.repo / "fixture.txt").write_text("unsaved user work\n")
        self.assertEqual(self.sync("default-branch"), "dirty (skipped), 0 behind")
        self.assertEqual(self.git(self.repo, "rev-parse", "origin/main"), self.original)

    def test_branch_switch_during_remote_read_is_skipped(self):
        self.git(self.repo, "branch", "feature")
        self.advance()
        self.change_after_remote_read('command git -C "$2" switch --quiet feature')
        result = self.sync()
        self.assertEqual(self.git(self.repo, "branch", "--show-current"), "feature")
        self.assertEqual(self.git(self.repo, "rev-parse", "feature"), self.original)
        self.assertEqual(self.git(self.repo, "rev-parse", "main"), self.original)
        self.assertEqual(result, "checkout changed (skipped)")

    def test_new_worktree_changes_during_remote_read_are_preserved(self):
        self.advance()
        self.change_after_remote_read(
            'printf "%s\\n" "concurrent user work" > "$2/concurrent.txt"'
        )
        result = self.sync()
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), self.original)
        self.assertEqual((self.repo / "concurrent.txt").read_text(), "concurrent user work\n")
        self.assertEqual(result, "checkout changed (skipped)")

    def test_clean_head_movement_during_remote_read_is_preserved(self):
        middle = self.advance()
        self.commit(self.seed, "second remote advance")
        self.git(self.seed, "push", "--quiet", "origin", "main")
        self.change_after_remote_read(
            f'command git -C "$2" merge --ff-only --quiet "{middle}"'
        )
        result = self.sync()
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), middle)
        self.assertEqual(self.git(self.repo, "status", "--porcelain"), "")
        self.assertEqual(result, "checkout changed (skipped)")

    def test_dirty_branch_switch_does_not_report_another_heads_count(self):
        tip = self.advance()
        self.git(self.repo, "fetch", "--quiet", "origin")
        self.git(self.repo, "branch", "feature", tip)
        (self.repo / "local.txt").write_text("unsaved user work\n")
        self.change_after_remote_read('command git -C "$2" switch --quiet feature')
        result = self.sync()
        self.assertEqual(self.git(self.repo, "branch", "--show-current"), "feature")
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), tip)
        self.assertEqual(self.git(self.repo, "rev-parse", "main"), self.original)
        self.assertEqual((self.repo / "local.txt").read_text(), "unsaved user work\n")
        self.assertEqual(result, "checkout changed (skipped)")

    def test_dirty_head_movement_is_detected_before_counting(self):
        tip = self.advance()
        (self.repo / "local.txt").write_text("unsaved user work\n")
        self.change_after_remote_read(
            f'command git -C "$2" merge --ff-only --quiet "{tip}"'
        )
        result = self.sync()
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), tip)
        self.assertEqual((self.repo / "local.txt").read_text(), "unsaved user work\n")
        self.assertEqual(result, "checkout changed (skipped)")

    def test_dirty_status_change_is_detected_before_counting(self):
        self.advance()
        (self.repo / "local.txt").write_text("unsaved user work\n")
        self.change_after_remote_read(
            'printf "%s\\n" "new user work" > "$2/new-local.txt"'
        )
        result = self.sync()
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), self.original)
        self.assertEqual((self.repo / "local.txt").read_text(), "unsaved user work\n")
        self.assertEqual((self.repo / "new-local.txt").read_text(), "new user work\n")
        self.assertEqual(result, "checkout changed (skipped)")

    def test_index_lock_is_an_error_not_divergence(self):
        self.advance()
        (self.repo / ".git/index.lock").write_text("another process\n")
        self.assertIn("error:", self.sync())
        self.assertEqual(self.git(self.repo, "rev-parse", "HEAD"), self.original)

    def test_default_ref_lock_is_an_error_not_divergence(self):
        self.git(self.repo, "switch", "--quiet", "-c", "feature")
        self.advance()
        (self.repo / ".git/refs/heads/main.lock").write_text("another process\n")
        self.assertIn("error:", self.sync("default-branch"))
        self.assertEqual(self.git(self.repo, "rev-parse", "main"), self.original)

    def test_default_checked_out_in_worktree_is_skipped(self):
        self.git(self.repo, "switch", "--quiet", "-c", "feature")
        self.git(self.repo, "worktree", "add", "--quiet", self.root / "linked", "main")
        self.advance()
        self.assertIn("in use by another worktree (skipped)", self.sync("default-branch"))
        self.assertEqual(self.git(self.repo, "rev-parse", "main"), self.original)

    def test_local_ahead_is_not_misreported_as_diverged(self):
        self.git(self.repo, "switch", "--quiet", "-c", "feature")
        self.git(self.repo, "switch", "--quiet", "main")
        ahead = self.commit(self.repo, "local ahead")
        self.git(self.repo, "switch", "--quiet", "feature")
        self.assertEqual(self.sync("default-branch"), "up-to-date (on feature)")
        self.assertEqual(self.git(self.repo, "rev-parse", "main"), ahead)

    def test_no_upstream_is_skipped(self):
        self.git(self.repo, "switch", "--quiet", "-c", "feature")
        self.assertEqual(self.sync(), "no upstream (skipped)")

    def test_detached_head_is_skipped(self):
        self.git(self.repo, "switch", "--quiet", "--detach")
        self.assertEqual(self.sync(), "detached (skipped)")

    def test_missing_origin_is_reported(self):
        self.git(self.repo, "remote", "remove", "origin")
        self.assertEqual(self.sync(), "error: no origin remote")

    def test_failed_fetch_is_reported(self):
        self.git(self.repo, "remote", "set-url", "origin", self.root / "absent.git")
        self.assertIn("error: fetch failed", self.sync())


class RoomResolutionTests(IsolatedFixture):
    def setUp(self):
        super().setUp()
        self.script = shell_example("project-room", "# Implements the resolution order")
        self.pointer = self.home / ".config/project-rooms/base"
        self.pointer.parent.mkdir(parents=True)

    def resolved_base(self):
        result = self.shell(self.script + '\nprintf "\\nBASE_RESULT=%s\\n" "$BASE"\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        return next(
            line.removeprefix("BASE_RESULT=") for line in result.stdout.splitlines()
            if line.startswith("BASE_RESULT=")
        )

    def test_absent_pointer_uses_default(self):
        self.assertEqual(self.resolved_base(), str(self.home / "project-rooms"))

    def test_existing_relative_pointer_is_rejected(self):
        (self.root / "relative-rooms").mkdir()
        self.pointer.write_text("relative-rooms\n")
        self.assertEqual(self.resolved_base(), str(self.home / "project-rooms"))

    def test_absolute_pointer_is_preserved(self):
        base = self.root / "chosen rooms"
        base.mkdir()
        self.pointer.write_text(str(base) + "\n")
        self.assertEqual(self.resolved_base(), str(base))

    def test_absent_absolute_base_remains_the_bootstrap_target(self):
        base = self.root / "not-created-yet"
        self.pointer.write_text(str(base) + "\n")
        self.assertEqual(self.resolved_base(), str(base))

    def test_home_shorthand_pointer_is_expanded(self):
        (self.home / "chosen").mkdir()
        self.pointer.write_text("~/chosen\n")
        self.assertEqual(self.resolved_base(), str(self.home / "chosen"))

    def test_named_user_tilde_is_not_mistaken_for_current_home(self):
        self.pointer.write_text("~someone/rooms\n")
        self.assertEqual(self.resolved_base(), str(self.home / "project-rooms"))

    def test_environment_takes_precedence(self):
        self.pointer.write_text("/unused-pointer\n")
        self.env["PROJECT_ROOMS_DIR"] = str(self.root / "environment-base")
        self.assertEqual(self.resolved_base(), self.env["PROJECT_ROOMS_DIR"])


class SkillMetadataTests(unittest.TestCase):
    def assert_allowed_tools_scalar(self, value):
        value = value.strip()
        self.assertTrue(
            value.strip("'\"").strip(),
            "allowed-tools must be a nonempty space-separated scalar",
        )
        self.assertFalse(
            value.startswith(("[", "{")),
            "allowed-tools must be a scalar, not a YAML flow collection",
        )

    def test_allowed_tools_rejects_collections_and_empty_values(self):
        for value in ("", "''", '""', "  ", "[Read, Grep]", "[]", "{Read: true}", "{}"):
            with self.subTest(value=value), self.assertRaises(AssertionError):
                self.assert_allowed_tools_scalar(value)

    def test_allowed_tools_accepts_plain_and_quoted_scalars(self):
        for value in ("Read Grep", "'Read Grep'", '"Read Grep"', '"[Read, Grep]"'):
            with self.subTest(value=value):
                self.assert_allowed_tools_scalar(value)

    def test_frontmatter_fits_the_portable_scalar_contract(self):
        for path in sorted((ROOT / "skills").glob("*/SKILL.md")):
            with self.subTest(skill=path.parent.name):
                header = path.read_text().split("---", 2)[1]
                fields = dict(re.findall(r"^([\w-]+):[ \t]*(.*)$", header, re.M))
                self.assertEqual(fields["name"], path.parent.name)
                description = fields["description"].strip("'\"").replace("''", "'")
                self.assertTrue(description)
                self.assertLessEqual(len(description), 1024)
                if "allowed-tools" in fields:
                    self.assert_allowed_tools_scalar(fields["allowed-tools"])


class AdversarialReviewContractTests(unittest.TestCase):
    """Structural slots the orchestrator must fill; behavior is dry-run in skill_scenarios.json."""

    @classmethod
    def setUpClass(cls):
        text = (ROOT / "skills" / "adversarial-review" / "SKILL.md").read_text()
        header = text.split("---", 2)[1]
        cls.description = re.search(r"^description: ['\"](.*)['\"]$", header, re.M).group(1)
        cls.body = text.split("---", 2)[2].lstrip()
        cls.sections = {}
        for chunk in cls.body.split("\n## ")[1:]:
            title, _, rest = chunk.partition("\n")
            cls.sections[title.strip()] = rest
        cls.order = list(cls.sections)

    def section(self, title):
        self.assertIn(title, self.sections, f"missing section: {title}")
        return self.sections[title]

    def test_updated_date_is_the_first_line_after_the_title(self):
        lines = [line for line in self.body.splitlines() if line.strip()]
        self.assertEqual(lines[0], "# Adversarial Review")
        self.assertRegex(lines[1], r"^Updated: (January|February|March|April|May|June|July|"
                                   r"August|September|October|November|December) \d{1,2}, \d{4}$")

    def test_hardcoded_updated_dates_match_the_skill_header(self):
        header_date = re.search(r"^Updated: (.+)$", self.body, re.M).group(1)
        hardcoded = set(re.findall(r"Updated: ((?:January|February|March|April|May|June|"
                                   r"July|August|September|October|November|December) "
                                   r"\d{1,2}, \d{4})", self.body))
        self.assertEqual(hardcoded, {header_date})

    def test_freshness_banner_is_the_first_response_line_before_mode_or_target(self):
        first = self.section("First Response Line")
        self.assertEqual(self.order[0], "First Response Line")
        self.assertIn("Adversarial review | Updated: <date>", first)
        self.assertIn("<skill-context name=\"adversarial-review\">", first)
        self.assertRegex(first, r"(?i)invocation card")

    def test_target_identification_precedes_mode_selection(self):
        self.assertLess(self.order.index("Identify the Target"), self.order.index("Choose the Mode"))
        target = self.section("Identify the Target")
        self.assertRegex(
            re.sub(r"\s+", " ", target),
            r"Repository file, plan, or change: .*repository-relative"
            r".*(?:commit SHA|immutable revision)",
        )
        self.assertRegex(target, r"(?i)uncommitted|mutable")
        self.assertRegex(target, r"(?i)(?:content|diff) hash")
        self.assertRegex(
            target,
            r"Pull request: [^\n]*URL[^\n]*(?:base and head commit SHAs|immutable diff hash)",
        )
        self.assertRegex(
            target,
            r"Comment, thread, or web document: [^\n]*URL"
            r"[^\n]*(?:immutable revision|content hash|snapshot hash)",
        )
        self.assertRegex(target, r"Pasted text that is not in a file: [^\n]*quotes")
        self.assertIn("ask before you launch reviewers", target)

    def test_review_intensity_is_one_public_control_with_auto_default(self):
        intensity = self.section("Review Intensity")
        self.assertLess(self.order.index("Identify the Target"),
                        self.order.index("Review Intensity"))
        self.assertLess(self.order.index("Review Intensity"),
                        self.order.index("Choose the Mode"))
        self.assertIn("`low | auto | max`", intensity)
        self.assertRegex(intensity, r"(?i)`auto` is the default")
        self.assertRegex(intensity, r"(?i)low[^\n]*at most one new reviewer")
        self.assertRegex(intensity, r"(?i)max[^\n]*fresh three-reviewer")
        self.assertNotRegex(intensity, r"`medium`|`high`")

    def test_public_description_covers_reuse_and_non_consensus_paths(self):
        self.assertRegex(self.description, r"(?i)reusing compatible prior coverage")
        self.assertRegex(
            self.description,
            r"(?i)up to three (?:separated )?first-pass"
            r"(?: separated)? adversarial reviewer perspectives",
        )
        self.assertRegex(self.description, r"(?i)without claiming consensus when none ran")

    def test_prior_review_reuse_precedes_capability_selection(self):
        self.assertLess(self.order.index("Choose the Mode"),
                        self.order.index("Prior Review Check"))
        self.assertLess(self.order.index("Prior Review Check"),
                        self.order.index("Capability Check"))
        prior = re.sub(r"\s+", " ", self.section("Prior Review Check"))
        self.assertRegex(prior, r"(?i)available session history")
        self.assertRegex(prior, r"(?i)exact target")
        self.assertRegex(
            prior,
            r"(?i)target locator.*immutable revision|immutable revision.*target locator",
        )
        self.assertRegex(prior, r"(?i)mutable target.*(?:content|diff) hash")
        self.assertRegex(
            prior,
            r"(?i)pull request.*full URL.*(?:base and head commit SHAs|immutable diff hash)",
        )
        self.assertRegex(
            prior,
            r"(?i)(?:comment|thread|web document).*URL"
            r".*(?:immutable revision|content hash|snapshot hash)",
        )
        self.assertRegex(prior, r"(?i)reuse.*same immutable identity")
        self.assertRegex(prior, r"(?i)review only the delta")
        self.assertRegex(prior, r"(?i)`max`[^\n]*bypass")
        self.assertRegex(prior, r"(?i)mode-compatible")
        self.assertRegex(prior, r"(?i)forces a different mode[^\n]*forced-mode work")

    def test_auto_reuse_requires_completed_challenge_coverage(self):
        prior = re.sub(r"\s+", " ", self.section("Prior Review Check"))
        self.assertRegex(
            prior,
            r"(?i)`auto`.*exact-target.*challenge coverage",
        )
        self.assertRegex(
            prior,
            r"(?i)material disagreement|suspected overstatement",
        )
        self.assertRegex(
            prior,
            r"(?i)groupthink.*unverified shared assumption",
        )
        self.assertRegex(
            prior,
            r"(?i)not.*`reused-review`.*one fresh challenge reviewer",
        )
        self.assertRegex(
            prior,
            r"(?i)challenge coverage.*incomplete.*do not resume"
            r".*prior reviewer.*one fresh challenge reviewer",
        )
        self.assertRegex(
            prior,
            r"(?i)`single-subagent`.*current-run.*Reviewers.*1",
        )
        self.assertRegex(
            prior,
            r"(?i)fresh challenge reviewer.*unavailable"
            r".*`single-agent`.*self-challenge",
        )
        for mode in ("SPAR Mode", "Rubber Duck Mode"):
            section = re.sub(r"\s+", " ", self.section(mode))
            self.assertRegex(
                section,
                r"(?i)challenge coverage incomplete.*prior (?:evidence|findings)"
                r".*independent challenge pass.*not.*first-pass",
            )

    def test_common_mistake_does_not_bypass_auto_challenge_coverage(self):
        mistakes = re.sub(r"\s+", " ", self.section("Common Mistakes"))
        row = re.search(
            r"Repeating an unchanged review.*?(?= \| [^|]+ \| [^|]+ \||$)",
            mistakes,
        ).group(0)

        self.assertRegex(row, r"(?i)challenge coverage")
        self.assertRegex(row, r"(?i)`max`")

    def test_changelog_qualifies_reuse_by_intensity(self):
        changelog = (ROOT / "CHANGELOG.md").read_text()
        entry = re.search(
            r"\*\*`adversarial-review`\*\*.*?(?=\n\n###|\n- \*\*`)",
            changelog,
            re.S,
        ).group(0)
        entry = re.sub(r"\s+", " ", entry)

        self.assertRegex(entry, r"(?i)`low`.*`auto`.*reuse")
        self.assertRegex(entry, r"(?i)`max`.*bypass.*fresh")
        self.assertRegex(entry, r"(?i)qualifying.*delta baseline.*review.*delta")

    def test_readme_qualifies_cross_examination_by_intensity(self):
        readme = (ROOT / "README.md").read_text()
        row = next(
            line for line in readme.splitlines()
            if line.startswith("| [`adversarial-review`]")
        )

        self.assertRegex(
            row,
            r"(?i)(?:at|under) `auto` (?:and|or) `max`[^.]*challenge",
        )
        self.assertRegex(
            row,
            r"(?i)cross-examin.*follow-up.*fallback",
        )

    def test_changelog_qualifies_cross_examination_fallbacks(self):
        changelog = (ROOT / "CHANGELOG.md").read_text()
        entry = re.search(
            r"\*\*`adversarial-review`\*\*.*?(?=\n\n###|\n- \*\*`)",
            changelog,
            re.S,
        ).group(0)
        entry = re.sub(r"\s+", " ", entry)

        self.assertRegex(
            entry,
            r"(?i)challenge.*disagreement.*cross-examination.*available"
            r".*fallback",
        )

    def test_exact_target_reuse_has_a_zero_reviewer_execution_path(self):
        capability = re.sub(r"\s+", " ", self.section("Capability Check"))
        self.assertIn("`reused-review`", capability)
        self.assertRegex(capability, r"(?i)qualifying exact-target reuse.*zero new reviewers")
        self.assertRegex(capability, r"(?i)current-run.*Reviewers.*0")
        self.assertRegex(
            capability,
            r"(?i)prior (?:panel|reviewers).*evidence.*reused",
        )
        self.assertRegex(
            capability,
            r"(?i)not.*newly performed consensus|do not.*newly performed consensus",
        )
        for mode in ("SPAR Mode", "Rubber Duck Mode"):
            section = re.sub(r"\s+", " ", self.section(mode))
            self.assertRegex(section, r"(?i)`reused-review`")
            self.assertRegex(section, r"(?i)prior (?:role perspectives|findings)")
            self.assertRegex(section, r"(?i)do not (?:create|run|launch).*new")

    def test_capability_check_records_reviewer_follow_up_support(self):
        capability = re.sub(r"\s+", " ", self.section("Capability Check"))
        self.assertRegex(
            capability,
            r"(?i)(?:follow-up|resume) capability",
        )
        self.assertRegex(
            capability,
            r"(?i)one-shot",
        )

    def test_intensity_history_scenario_guarantees_reviewer_follow_up(self):
        scenarios = json.loads((ROOT / "tests" / "skill_scenarios.json").read_text())
        scenario = next(
            item for item in scenarios["scenarios"]
            if item["id"] == "adversarial-intensity-and-history"
        )

        self.assertRegex(scenario["input"], r"(?i)(?:follow-up|resume)")

    def test_changed_target_uses_prior_revision_only_as_delta_baseline(self):
        prior = re.sub(r"\s+", " ", self.section("Prior Review Check"))
        self.assertRegex(prior, r"(?i)exact-target reuse")
        self.assertRegex(prior, r"(?i)prior immutable revision")
        self.assertRegex(prior, r"(?i)same logical target")
        self.assertRegex(prior, r"(?i)both (?:the )?current and prior revisions.*accessible")
        self.assertRegex(prior, r"(?i)mode-compatible")
        self.assertRegex(prior, r"(?i)only as (?:a )?delta baseline")

    def test_mode_is_automatic_unless_user_explicitly_forces_it(self):
        mode = self.section("Choose the Mode")
        self.assertRegex(mode, r"(?i)desired output")
        self.assertIn("force SPAR", mode)
        self.assertIn("force Rubber Duck", mode)
        self.assertRegex(mode, r"(?i)explicit.*override")
        self.assertRegex(mode, r"(?i)review, critique, or audit")

    def test_reviewer_guard_is_defined_and_required_in_both_modes(self):
        guard = self.section("Reviewer Guard")
        self.assertIn("```text\nReviewer guard:", guard)
        self.assertRegex(guard, r"Do not load the adversarial-review skill\.")
        self.assertRegex(guard, r"Do not launch agents")
        self.assertNotIn("Do not follow the rest of this skill", guard)
        self.assertIn("strongest objection", guard, "SPAR reviewers return role fields")
        for kept in ("Premortem Pass", "Review Constitution", "Reviewer Output Schema",
                     "Severity and Confidence Calibration", "Evidence Standards"):
            self.assertIn(kept, guard)
        for mode in ("SPAR Mode", "Rubber Duck Mode"):
            self.assertIn("reviewer guard", self.section(mode).lower())

    def test_spar_handles_the_single_subagent_path(self):
        self.assertIn("`single-subagent`", self.section("SPAR Mode"))

    def test_spar_retains_reused_roles_or_selects_fresh_roles_within_the_context_cap(self):
        spar = re.sub(r"\s+", " ", self.section("SPAR Mode"))
        self.assertRegex(
            spar,
            r"(?i)`reused-review`.*retain.*prior review.*role set",
        )
        self.assertRegex(
            spar,
            r"(?i)(?:all other|non-reused).*paths.*pick 3-5 fresh roles",
        )
        self.assertRegex(
            spar,
            r"(?i)one primary role per selected independent (?:reviewer )?context",
        )
        self.assertRegex(spar, r"(?i)at most three first-pass reviewer contexts")
        self.assertRegex(
            spar,
            r"(?i)(?:remaining|extra) fresh roles.*sequentially.*main synthesizer",
        )
        self.assertRegex(spar, r"(?i)disclose.*simulated roles")
        self.assertRegex(
            spar,
            r"(?i)synthesize only after every selected or retained role has a perspective",
        )

    def test_reviewers_use_rubber_duck_agent_type_with_disclosed_fallback(self):
        dispatch = self.section("Rubber Duck Mode") + self.section("SPAR Mode")
        self.assertIn("agent_type: rubber-duck", dispatch)
        self.assertIn("rubber-duck unavailable", self.body)

    def test_rubber_duck_steps_are_sequentially_numbered(self):
        numbers = [
            int(match)
            for match in re.findall(r"(?m)^(\d+)\. ", self.section("Rubber Duck Mode"))
        ]
        self.assertEqual(numbers, list(range(1, len(numbers) + 1)))

    def test_disclosure_names_path_with_updated_date_and_one_premortem_sentence(self):
        disclose = self.section("Always Disclose")
        self.assertRegex(disclose, r"Execution path: <[^>]+> \(adversarial-review, Updated: <date>\)")
        self.assertIn("Review intensity: <low | auto | max>", disclose)
        self.assertIn("Prior review:", disclose)
        self.assertRegex(disclose, r"Premortem: <one sentence")
        block = re.search(r"```text\n(.*?)```", disclose, re.S).group(1)
        self.assertNotIn("Target:", block, "Target is written once, before mode selection")
        self.assertIn("after the review completes", disclose)
        outcomes = re.search(
            r"Use one of these concise prior-review outcomes:\n(.*?)\n\n",
            disclose,
            re.S,
        ).group(1)
        self.assertIn("`delta baseline found`", outcomes)
        self.assertIn("`challenge coverage incomplete`", outcomes)
        self.assertNotIn("`reviewed delta`", outcomes)
        self.assertRegex(
            disclose,
            r"(?is)delta (?:path|baseline).*pre-launch"
            r".*delta (?:was )?reviewed.*only after.*complet",
        )

    def test_cross_examination_calibrates_overstatement_and_disagreement(self):
        cross = re.sub(r"\s+", " ", self.section("Cross-Examination Round"))
        self.assertRegex(
            cross,
            r"(?i)Rubber Duck.*existence.*scope.*severity.*recommended action",
        )
        for outcome in ("uphold", "narrow", "downgrade", "withdraw"):
            self.assertIn(outcome, cross.lower())
        self.assertRegex(
            cross,
            r"(?i)SPAR.*objections.*support.*assumptions.*tradeoffs.*failure modes",
        )
        for outcome in ("stands", "narrows", "rebutted", "unresolved tradeoff",
                        "unresolved assumption"):
            self.assertIn(outcome, cross.lower())
        self.assertRegex(
            cross,
            r"(?i)`auto`.*material disagreement.*suspected overstatement.*either mode",
        )
        self.assertRegex(
            cross,
            r"(?i)`max`.*critical or high Rubber Duck finding"
            r".*material SPAR claim.*verdict or recommendation.*every disagreement",
        )
        self.assertRegex(
            cross,
            r"(?i)`max`.*always run a challenge round",
        )
        self.assertRegex(
            cross,
            r"(?i)(?:if|when) (?:those|these) sets are empty"
            r".*highest-impact remaining Rubber Duck finding"
            r".*strongest decision-relevant SPAR claim",
        )
        self.assertRegex(
            cross,
            r"(?i)`max`.*always run a groupthink assumption check"
            r".*shared assumption.*panel wrong",
        )
        self.assertRegex(
            cross,
            r"(?i)`auto`.*groupthink check"
            r".*agreement rests on an unverified shared assumption",
        )
        self.assertRegex(cross, r"(?i)synthesizer decides.*does not add votes")
        judge = re.sub(r"\s+", " ", self.section("Judge/Synthesizer Rules"))
        self.assertRegex(judge, r"(?i)actionable")
        self.assertRegex(judge, r"(?i)consensus.*signal")

    def test_ranking_is_impact_first_and_examples_do_not_sort_by_reviewer_count(self):
        self.assertNotIn("consensus-ranked", self.body.lower())
        aggregation = re.sub(r"\s+", " ", self.section("Consensus Aggregation"))
        self.assertRegex(
            aggregation,
            r"(?i)rank surviving findings by impact, actionability, confidence, "
            r"and evidence quality",
        )
        self.assertRegex(
            aggregation,
            r"(?i)reviewer count.*prioritization signal and tie-breaker, not proof",
        )
        example = re.sub(r"\s+", " ", self.section("Example"))
        self.assertRegex(
            example,
            r"(?i)rank by impact, actionability, confidence, and evidence quality"
            r".*reviewer count only as a tie-breaker",
        )
        self.assertLess(example.index("found by 1 reviewer"),
                        example.index("found by 3 reviewers"))

    def test_reviewer_failure_keeps_impact_first_ranking(self):
        failure = re.sub(r"\s+", " ", self.section("Reviewer Failure Handling"))
        self.assertNotRegex(
            failure,
            r"(?i)rank consensus by completed reviewer count",
        )
        self.assertRegex(
            failure,
            r"(?i)rank surviving findings by impact, actionability, confidence, "
            r"and evidence quality",
        )
        self.assertRegex(
            failure,
            r"(?i)completed reviewer count.*disclos.*(?:support|tie-breaker)",
        )

    def test_max_degrades_to_named_self_challenge_without_claiming_cross_examination(self):
        intensity = re.sub(r"\s+", " ", self.section("Review Intensity"))
        self.assertRegex(
            intensity,
            r"(?i)`max`.*fresh three-reviewer panel when available"
            r".*mandatory challenge round.*groupthink assumption check",
        )

        cross = re.sub(r"\s+", " ", self.section("Cross-Examination Round"))
        self.assertRegex(
            cross,
            r"(?i)at least one independent reviewer.*usable.*(?:follow-up|resume)"
            r".*reviewer cross-examination",
        )
        self.assertRegex(
            cross,
            r"(?i)(?:cannot|cannot be|unable to) (?:resume|receive follow-up)"
            r".*fresh challenge reviewer.*independent challenge pass",
        )
        self.assertRegex(
            cross,
            r"(?i)fresh challenge reviewer.*(?:fails|unavailable|unusable)"
            r".*self-challenge pass.*(?:highest-impact Rubber Duck finding"
            r"|strongest decision-relevant SPAR claim)"
            r".*assumption check",
        )
        self.assertRegex(
            cross,
            r"(?i)do not call.*self-challenge.*reviewer cross-examination",
        )
        self.assertRegex(
            cross,
            r"(?i)(?:usable independent first-pass reviews.*self-challenge"
            r"|self-challenge.*usable independent first-pass reviews)"
            r".*do not.*independent consensus unavailable",
        )
        self.assertRegex(
            cross,
            r"(?i)no usable independent first-pass reviews"
            r".*independent consensus unavailable",
        )
        self.assertRegex(
            cross,
            r"(?i)groupthink assumption check.*shared assumption.*panel wrong"
            r".*degraded self-challenge.*default assumption"
            r".*single-agent critique wrong",
        )

        failure = re.sub(r"\s+", " ", self.section("Reviewer Failure Handling"))
        self.assertRegex(
            failure,
            r"(?i)no reviewer returns usable findings.*`max`"
            r".*degraded.*self-challenge",
        )
        self.assertRegex(
            failure,
            r"(?i)otherwise.*fall back to `single-agent` critique",
        )

        disclose = re.sub(r"\s+", " ", self.section("Always Disclose"))
        self.assertRegex(
            disclose,
            r"(?i)Challenge round: <reviewer cross-examination"
            r" \| independent challenge pass \| self-challenge pass"
            r" \| not required>",
        )
        self.assertIn("Priority ranking:", disclose)
        self.assertNotIn("Consensus ranking:", disclose)
        self.assertRegex(
            disclose,
            r"(?i)no usable independent first-pass reviews"
            r".*independent consensus unavailable",
        )
        self.assertRegex(
            disclose,
            r"(?i)(?:usable independent first-pass reviews.*self-challenge"
            r"|self-challenge.*usable independent first-pass reviews)"
            r".*do not.*independent consensus unavailable",
        )

    def test_disclosure_example_matches_the_required_schema(self):
        example = self.section("Example")
        disclosure = re.search(
            r"Disclosure example:\s*```text\n(.*?)\n```",
            example,
            re.S,
        ).group(1)

        self.assertIn("Challenge round:", disclosure)
        self.assertIn("Priority ranking:", disclosure)
        self.assertNotIn("Consensus ranking:", disclosure)

    def test_each_reviewer_gets_an_explicit_model_and_the_started_model_is_checked(self):
        models = re.sub(r"\s+", " ", self.section("Model Diversity Heuristic"))
        self.assertIn("Pass an explicit `model` for every reviewer", models)
        self.assertIn("model that actually started", models)
        self.assertIn("If the runtime does not accept a model override", models)
        self.assertIn("recalculate the execution path from the started models", models)

    def test_third_context_fallback_is_disclosed_as_two_providers(self):
        models = re.sub(r"\s+", " ", self.section("Model Diversity Heuristic"))
        self.assertIn("three contexts, two providers", models)
        self.assertIn("never Google or Gemini", models)
        for rule in (r"2\. \*\*Use the preferred provider trio\.\*\*", r"7\. \*\*Never fabricate\.\*\*"):
            text = re.search(rule + r"(.*?)(?= \d+\. \*\*)", models).group(1)
            self.assertIn("rule 9", text, f"rule must defer to rule 9: {rule}")

    def test_current_provider_trio_is_preserved(self):
        models = re.sub(r"\s+", " ", self.section("Model Diversity Heuristic"))
        self.assertIn("OpenAI, Anthropic, and xAI", models)
        self.assertIn("Google and Gemini models are not eligible", models)
        self.assertIn("`xhigh` for every reviewer", models)


if __name__ == "__main__":
    unittest.main()
