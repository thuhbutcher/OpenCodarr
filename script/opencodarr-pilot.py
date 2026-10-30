#!/usr/bin/env python3
"""Run a verified OpenCodarr candidate with a separate, explicitly selected profile."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys


PROFILE_SCHEMA = "opencodarr.pilot-profile.v1"
MARKER = ".opencodarr-pilot"
ROOTS = ("home", "config", "data", "cache", "state", "tmp", "runtime")
SYSTEM_CONFIG_PATH = Path("/etc/opencode")


def absolute(value: str, label: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        raise ValueError(f"{label} must be an absolute path")
    return path


def overlaps(first: Path, second: Path) -> bool:
    return first == second or first in second.parents or second in first.parents


def protected_roots() -> list[Path]:
    roots: list[Path] = []
    home = os.environ.get("HOME")
    if home and Path(home).is_absolute():
        base = Path(home)
        roots.extend(base / suffix for suffix in (
            ".opencode", ".config/opencode", ".local/share/opencode", ".local/state/opencode", ".cache/opencode",
        ))
    for variable in ("XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR"):
        value = os.environ.get(variable)
        if value and Path(value).is_absolute():
            roots.append(Path(value) / "opencode")
    for variable in ("OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR", "OPENCODE_DB"):
        value = os.environ.get(variable)
        if value and Path(value).is_absolute():
            roots.append(Path(value))
    return [path.resolve(strict=False) for path in roots]


def private_directory(path: Path) -> None:
    if path.is_symlink() or not path.is_dir():
        raise ValueError(f"profile path is not a real directory: {path}")
    info = path.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise ValueError(f"profile directory must be private and owned by the current user: {path}")


def marker_text(digest: str) -> str:
    return json.dumps({"schema": PROFILE_SCHEMA, "binary_sha256": digest}, sort_keys=True) + "\n"


def check_profile_links(path: Path) -> None:
    def fail(error: OSError) -> None:
        raise error

    for directory, dirs, files in os.walk(path, followlinks=False, onerror=fail):
        for name in dirs + files:
            entry = Path(directory) / name
            if not entry.is_symlink():
                continue
            target = entry.resolve(strict=False)
            if target != path and path not in target.parents:
                raise ValueError("profile contains a symlink pointing outside its root")


def inspect_profile(path: Path, digest: str) -> str:
    if path.is_symlink():
        raise ValueError("profile must not be a symlink")
    if not path.exists():
        if not path.parent.is_dir():
            raise ValueError("profile parent must already exist")
        return "new"
    private_directory(path)
    marker = path / MARKER
    if marker.is_symlink():
        raise ValueError("profile marker must not be a symlink")
    if not marker.exists():
        if any(path.iterdir()):
            raise ValueError("unmarked profile directory must be empty")
        state = "empty"
    else:
        if not marker.is_file() or marker.read_text(encoding="utf-8") != marker_text(digest):
            raise ValueError("profile marker does not match the selected binary")
        state = "existing"
    for name in ROOTS:
        root = path / name
        if root.is_symlink():
            raise ValueError(f"profile root must not be a symlink: {name}")
        if root.exists():
            private_directory(root)
        if name in ("config", "data", "cache", "state", "tmp"):
            nested = root / "opencode"
            if nested.is_symlink():
                raise ValueError(f"OpenCode state root must not be a symlink: {name}")
            if nested.exists():
                private_directory(nested)
    check_profile_links(path)
    return state


def initialize_profile(path: Path, digest: str, state: str) -> None:
    if state == "new":
        path.mkdir(mode=0o700)
    if state in ("new", "empty"):
        with (path / MARKER).open("x", encoding="utf-8") as marker:
            marker.write(marker_text(digest))
    for name in ROOTS:
        (path / name).mkdir(mode=0o700, exist_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Start OpenCodarr with an isolated local profile and standalone server.")
    parser.add_argument("--binary", required=True, help="Absolute path to the selected executable")
    parser.add_argument("--sha256", required=True, help="Expected SHA-256 of that executable")
    parser.add_argument("--profile", required=True, help="Absolute path to a new, empty, or matching pilot profile")
    parser.add_argument("--workspace", required=True, help="Absolute path to the explicitly selected project directory")
    parser.add_argument("--with-project-config", action="store_true", help="Enable the workspace's OpenCode configuration and project instruction discovery")
    parser.add_argument("--check", action="store_true", help="Validate inputs without creating a profile or starting OpenCodarr")
    args = parser.parse_args()

    try:
        if sys.platform != "linux":
            raise ValueError("this pilot currently supports Linux only")
        if os.path.lexists(SYSTEM_CONFIG_PATH):
            raise ValueError("system OpenCode configuration is present; select an isolated configuration before launching")
        if not re.fullmatch(r"[0-9a-f]{64}", args.sha256):
            raise ValueError("sha256 must be 64 lowercase hexadecimal characters")
        binary = absolute(args.binary, "binary").resolve(strict=True)
        if not binary.is_file() or not os.access(binary, os.X_OK):
            raise ValueError("binary must be an executable file")
        digest = hashlib.sha256()
        with binary.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != args.sha256:
            raise ValueError("binary SHA-256 does not match")

        workspace = absolute(args.workspace, "workspace").resolve(strict=True)
        if not workspace.is_dir():
            raise ValueError("workspace must be a directory")
        if not args.with_project_config and any(os.path.lexists(path / "AGENTS.md") for path in (workspace, *workspace.parents)):
            raise ValueError("workspace has project instructions; use --with-project-config to enable their discovery")
        if not args.with_project_config and any(workspace.iterdir()):
            raise ValueError("default pilot mode needs an empty workspace; use --with-project-config for project work")
        raw_profile = absolute(args.profile, "profile")
        if raw_profile.is_symlink():
            raise ValueError("profile must not be a symlink")
        profile = raw_profile.resolve(strict=False)
        if overlaps(profile, workspace):
            raise ValueError("profile and workspace must not overlap")
        if any(overlaps(profile, protected) for protected in protected_roots()):
            raise ValueError("profile overlaps an existing OpenCode state or configuration path")
        state = inspect_profile(profile, args.sha256)
        if args.check:
            print(json.dumps({"status": "PRECHECK_PASS", "profile_state": state, "binary_sha256": args.sha256,
                              "mode": "standalone", "project_config_enabled": args.with_project_config}))
            return 0

        os.umask(0o077)
        initialize_profile(profile, args.sha256, state)
        env = {
            "HOME": str(profile / "home"),
            "XDG_CONFIG_HOME": str(profile / "config"),
            "XDG_DATA_HOME": str(profile / "data"),
            "XDG_CACHE_HOME": str(profile / "cache"),
            "XDG_STATE_HOME": str(profile / "state"),
            "XDG_RUNTIME_DIR": str(profile / "runtime"),
            "TMPDIR": str(profile / "tmp"),
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "OPENCODE_CONFIG_PROJECT_DISABLE": "0" if args.with_project_config else "1",
            "OPENCODE_DISABLE_CLAUDE_CODE": "1",
            "OPENCODE_DISABLE_MODELS_FETCH": "1",
            "OPENCODE_DISABLE_AUTOUPDATE": "1",
            "GIT_CONFIG_NOSYSTEM": "1",
        }
        for name in ("TERM", "COLORTERM", "LANG", "LC_ALL", "NO_COLOR", "CLICOLOR", "TZ"):
            if name in os.environ:
                env[name] = os.environ[name]
        os.execve(str(binary), [str(binary), "--standalone", str(workspace)], env)
    except (OSError, ValueError) as error:
        print(f"OpenCodarr pilot: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
