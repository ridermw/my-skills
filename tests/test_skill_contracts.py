"""Exercise the shipped shell examples against isolated, local-only fixtures."""

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


if __name__ == "__main__":
    unittest.main()
