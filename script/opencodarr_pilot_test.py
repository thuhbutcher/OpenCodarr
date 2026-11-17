import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr
from unittest.mock import patch


LAUNCHER = Path(__file__).with_name("opencodarr-pilot.py")
SPEC = importlib.util.spec_from_file_location("opencodarr_pilot", LAUNCHER)
PILOT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PILOT)


class PilotLauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="opencodarr-pilot-test-")
        self.root = Path(self.temp.name)
        self.home = self.root / "operator-home"
        self.home.mkdir(mode=0o700)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        self.profile = self.root / "profile"
        self.capture = self.root / "capture.json"
        self.binary = self.root / "stub"
        self.binary.write_text(
            "#!/usr/bin/python3\n"
            "import json, os, sys\n"
            f"with open({str(self.capture)!r}, 'w') as output:\n"
            "    json.dump({'argv': sys.argv[1:], 'env': dict(os.environ)}, output)\n"
        )
        self.binary.chmod(0o700)
        self.digest = hashlib.sha256(self.binary.read_bytes()).hexdigest()
        self.env = {
            "HOME": str(self.home),
            "PATH": "/usr/bin:/bin",
            "TERM": "xterm-256color",
            "XDG_CONFIG_HOME": str(self.home / "config"),
            "XDG_DATA_HOME": str(self.home / "data"),
            "XDG_STATE_HOME": str(self.home / "state"),
            "XDG_CACHE_HOME": str(self.home / "cache"),
            "OPENCODE_PASSWORD": "synthetic-do-not-use",
            "OPENCODE_CONFIG_CONTENT": "synthetic-inherited-config",
            "OPENAI_API_KEY": "synthetic-do-not-use",
        }

    def tearDown(self):
        self.temp.cleanup()

    def run_pilot(self, *extra, profile=None, workspace=None, digest=None):
        return subprocess.run(
            [
                "/usr/bin/python3", str(LAUNCHER),
                "--binary", str(self.binary), "--sha256", digest or self.digest,
                "--profile", str(profile or self.profile), "--workspace", str(workspace or self.workspace),
                *extra,
            ],
            env=self.env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=10,
        )

    def test_check_does_not_create_or_execute(self):
        result = self.run_pilot("--check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "PRECHECK_PASS")
        self.assertFalse(self.profile.exists())
        self.assertFalse(self.capture.exists())

    def test_launch_is_standalone_with_isolated_roots_and_scrubbed_environment(self):
        result = self.run_pilot()
        self.assertEqual(result.returncode, 0, result.stderr)
        captured = json.loads(self.capture.read_text())
        self.assertEqual(captured["argv"], ["--standalone", str(self.workspace)])
        env = captured["env"]
        self.assertEqual(env["HOME"], str(self.profile / "home"))
        self.assertEqual(env["XDG_DATA_HOME"], str(self.profile / "data"))
        self.assertEqual(env["XDG_STATE_HOME"], str(self.profile / "state"))
        self.assertEqual(env["OPENCODE_CONFIG_PROJECT_DISABLE"], "1")
        self.assertEqual(env["OPENCODE_DISABLE_MODELS_FETCH"], "1")
        self.assertEqual(env["OPENCODE_DISABLE_AUTOUPDATE"], "1")
        self.assertEqual(env["GIT_CONFIG_NOSYSTEM"], "1")
        for key in ("OPENCODE_PASSWORD", "OPENCODE_CONFIG_CONTENT", "OPENAI_API_KEY"):
            self.assertNotIn(key, env)
        self.assertEqual(stat.S_IMODE(self.profile.stat().st_mode), 0o700)
        self.assertEqual(json.loads((self.profile / ".opencodarr-pilot").read_text())["binary_sha256"], self.digest)

    def test_wrong_binary_hash_fails_before_profile_creation(self):
        result = self.run_pilot(digest="0" * 64)
        self.assertEqual(result.returncode, 2)
        self.assertIn("SHA-256 does not match", result.stderr)
        self.assertFalse(self.profile.exists())
        self.assertFalse(self.capture.exists())

    def test_nonempty_unmarked_profile_is_preserved(self):
        self.profile.mkdir(mode=0o700)
        data = self.profile / "existing.txt"
        data.write_text("preserve")
        result = self.run_pilot()
        self.assertEqual(result.returncode, 2)
        self.assertEqual(data.read_text(), "preserve")
        self.assertFalse(self.capture.exists())

    def test_existing_profile_is_bound_to_binary_hash(self):
        self.assertEqual(self.run_pilot().returncode, 0)
        self.capture.unlink()
        self.binary.write_text(self.binary.read_text() + "\n# distinct binary\n")
        self.digest = hashlib.sha256(self.binary.read_bytes()).hexdigest()
        result = self.run_pilot()
        self.assertEqual(result.returncode, 2)
        self.assertIn("marker does not match", result.stderr)
        self.assertFalse(self.capture.exists())

    def test_existing_profile_can_be_reused_for_same_binary(self):
        self.assertEqual(self.run_pilot().returncode, 0)
        result = self.run_pilot("--check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["profile_state"], "existing")

    def test_profile_cannot_overlap_workspace_or_known_opencode_roots(self):
        result = self.run_pilot(profile=self.workspace)
        self.assertEqual(result.returncode, 2)
        self.assertIn("must not overlap", result.stderr)
        result = self.run_pilot(profile=self.home / ".opencode" / "pilot")
        self.assertEqual(result.returncode, 2)
        self.assertIn("overlaps an existing OpenCode", result.stderr)
        self.assertFalse(self.capture.exists())

    def test_symlink_profile_or_state_root_is_rejected(self):
        target = self.root / "other"
        target.mkdir(mode=0o700)
        self.profile.symlink_to(target, target_is_directory=True)
        result = self.run_pilot()
        self.assertEqual(result.returncode, 2)
        self.profile.unlink()
        self.assertEqual(self.run_pilot().returncode, 0)
        self.capture.unlink()
        (self.profile / "config").rmdir()
        (self.profile / "config").symlink_to(target, target_is_directory=True)
        result = self.run_pilot()
        self.assertEqual(result.returncode, 2)
        self.assertIn("must not be a symlink", result.stderr)
        self.assertFalse(self.capture.exists())

    def test_deep_symlink_outside_profile_is_rejected(self):
        self.assertEqual(self.run_pilot().returncode, 0)
        self.capture.unlink()
        nested = self.profile / "data" / "opencode"
        nested.mkdir(mode=0o700)
        (nested / "storage").symlink_to(self.workspace, target_is_directory=True)
        result = self.run_pilot()
        self.assertEqual(result.returncode, 2)
        self.assertIn("symlink pointing outside", result.stderr)
        self.assertFalse(self.capture.exists())

    def test_missing_profile_root_can_be_restored_after_partial_initialization(self):
        self.assertEqual(self.run_pilot().returncode, 0)
        (self.profile / "runtime").rmdir()
        result = self.run_pilot()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.profile / "runtime").is_dir())

    def test_system_opencode_config_path_fails_closed_without_inspection(self):
        system_path = self.root / "system-opencode"
        system_path.mkdir()
        arguments = [str(LAUNCHER), "--binary", str(self.binary), "--sha256", self.digest,
                     "--profile", str(self.profile), "--workspace", str(self.workspace), "--check"]
        error = io.StringIO()
        with patch.object(PILOT, "SYSTEM_CONFIG_PATH", system_path), patch.dict(os.environ, self.env, clear=True), \
                patch("sys.argv", arguments), redirect_stderr(error):
            result = PILOT.main()
        self.assertEqual(result, 2)
        self.assertIn("system OpenCode configuration is present", error.getvalue())
        self.assertFalse(self.profile.exists())
        self.assertFalse(self.capture.exists())

    def test_unknown_server_override_is_rejected(self):
        result = self.run_pilot("--server", "http://127.0.0.1:1234")
        self.assertEqual(result.returncode, 2)
        self.assertFalse(self.profile.exists())
        self.assertFalse(self.capture.exists())

    def test_project_instructions_require_explicit_project_mode(self):
        (self.workspace / "AGENTS.md").write_text("Synthetic project instructions")
        result = self.run_pilot("--check")
        self.assertEqual(result.returncode, 2)
        self.assertIn("use --with-project-config", result.stderr)
        self.assertFalse(self.profile.exists())
        result = self.run_pilot("--with-project-config")
        self.assertEqual(result.returncode, 0, result.stderr)
        captured = json.loads(self.capture.read_text())
        self.assertEqual(captured["env"]["OPENCODE_CONFIG_PROJECT_DISABLE"], "0")

    def test_ancestor_instructions_are_not_silently_ignored(self):
        (self.root / "AGENTS.md").write_text("Synthetic parent instructions")
        result = self.run_pilot("--check")
        self.assertEqual(result.returncode, 2)
        self.assertIn("use --with-project-config", result.stderr)
        self.assertFalse(self.profile.exists())

    def test_nonempty_project_needs_explicit_project_mode(self):
        (self.workspace / "project.txt").write_text("Synthetic project file")
        result = self.run_pilot("--check")
        self.assertEqual(result.returncode, 2)
        self.assertIn("default pilot mode needs an empty workspace", result.stderr)
        self.assertFalse(self.profile.exists())
        result = self.run_pilot("--with-project-config", "--check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["project_config_enabled"])

    def test_profile_must_be_private(self):
        self.profile.mkdir(mode=0o755)
        self.profile.chmod(0o755)
        result = self.run_pilot()
        self.assertEqual(result.returncode, 2)
        self.assertIn("must be private", result.stderr)
        self.assertFalse(self.capture.exists())


if __name__ == "__main__":
    unittest.main()
