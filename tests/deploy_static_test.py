"""Offline SFTP deployment tests; no dependency or hosting connection needed."""

import base64
from contextlib import redirect_stderr, redirect_stdout
import errno
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import posixpath
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "deploy_static.py"
SPEC = importlib.util.spec_from_file_location("deploy_static", SCRIPT)
DEPLOY = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = DEPLOY
SPEC.loader.exec_module(DEPLOY)
REVISION = "a123456789abcdef0123456789abcdef01234567"
KEY_TYPE = "ssh-ed25519"
KEY_WIRE = len(KEY_TYPE).to_bytes(4, "big") + KEY_TYPE.encode() + (32).to_bytes(4, "big") + b"k" * 32
KNOWN_HOSTS = "[ftp.insertcreator.com]:222 ssh-ed25519 " + base64.b64encode(KEY_WIRE).decode()


class FakeSSH:
    def __init__(self, *, failure=None, tamper_size=False, root="/account", unsupported_rename=False):
        self.events = []
        self.current = root
        self.dirs = {"/", "/account", "/account/public_html"}
        self.storage = {"/account/public_html/.htaccess": b"hosting config", "/account/public_html/unknown.txt": b"leave me"}
        self.file_modes = {}
        self.failure = failure
        self.tamper_size = tamper_size
        self.unsupported_rename = unsupported_rename
        self.server_wire = KEY_WIRE
        self.server_type = KEY_TYPE
        self.authenticated = True
        self.security = SimpleNamespace(key_types=("ssh-ed25519", "ecdsa-sha2-nistp256", "rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"))
        self.backend = SimpleNamespace(Transport=self.make_transport, SFTPClient=SimpleNamespace(from_transport=self.from_transport))

    def record(self, method, *args):
        self.events.append((method, *args))
        if method == self.failure:
            raise OSError("server echoed private-user private-password")

    def socket_factory(self, address, *, timeout):
        self.record("connect", address, timeout)
        return SimpleNamespace(close=lambda: self.record("socket.close"))

    def make_transport(self, connection):
        self.record("Transport")
        return self

    def get_security_options(self):
        return self.security

    def start_client(self, *, timeout):
        self.record("start_client", timeout)

    def get_remote_server_key(self):
        self.record("get_remote_server_key")
        return SimpleNamespace(get_name=lambda: self.server_type, asbytes=lambda: self.server_wire)

    def auth_password(self, username, password, *, fallback):
        self.record("auth_password", username, password, fallback)

    def is_authenticated(self):
        return self.authenticated

    def from_transport(self, transport):
        self.record("SFTPClient.from_transport")
        return self

    def get_channel(self):
        return SimpleNamespace(settimeout=lambda timeout: self.record("channel.settimeout", timeout))

    def chdir(self, path):
        target = posixpath.normpath(posixpath.join(self.current, path))
        self.record("chdir", path)
        if target not in self.dirs:
            raise FileNotFoundError(errno.ENOENT, "missing")
        self.current = target

    def normalize(self, path):
        self.record("normalize", path)
        return posixpath.normpath(posixpath.join(self.current, path))

    def mkdir(self, path):
        self.record("mkdir", path)
        self.dirs.add(posixpath.normpath(posixpath.join(self.current, path)))

    def putfo(self, stream, path, *, file_size, confirm):
        self.record("putfo", path, file_size, confirm)
        self.storage[path] = stream.read()

    def stat(self, path):
        self.record("stat", path)
        if path not in self.storage:
            raise FileNotFoundError(errno.ENOENT, "missing")
        return SimpleNamespace(st_size=len(self.storage[path]) + int(self.tamper_size), st_mode=self.file_modes.get(path, stat.S_IFREG | 0o644))

    def posix_rename(self, temporary, target):
        self.record("posix_rename", temporary, target)
        if self.unsupported_rename:
            raise OSError(errno.EOPNOTSUPP, "Operation unsupported")
        self.storage[target] = self.storage.pop(temporary)

    def rename(self, temporary, target):
        self.record("rename", temporary, target)
        if target in self.storage:
            raise FileExistsError(errno.EEXIST, "target exists")
        self.storage[target] = self.storage.pop(temporary)

    def close(self):
        self.record("close")


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.source = Path(self.temporary.name) / "dist"
        self.source.mkdir()
        (self.source / "index.html").write_text("<html>new release</html>", encoding="utf-8")
        (self.source / "sw.js").write_text("// new worker", encoding="utf-8")
        (self.source / "app.js").write_text("// new app", encoding="utf-8")
        (self.source / "vendor").mkdir()
        (self.source / "vendor" / "library.js").write_bytes(b"library\x00bytes")
        self.environment = {"FTP_HOST": "ftp.insertcreator.com", "FTP_USERNAME": "private-user", "FTP_PASSWORD": "private-password", "FTP_KNOWN_HOSTS": KNOWN_HOSTS}

    def plan(self):
        return DEPLOY.build_plan(self.source, REVISION)

    def deploy(self, fake, **kwargs):
        return DEPLOY.deploy(self.plan(), host="ftp.insertcreator.com", username="private-user", password="private-password", known_hosts=KNOWN_HOSTS, ssh_backend=fake.backend, socket_factory=fake.socket_factory, **kwargs)

    def main(self, *, environment=None, fake=None, extra=()):
        out, err = io.StringIO(), io.StringIO()
        fake = fake or FakeSSH()
        with redirect_stdout(out), redirect_stderr(err):
            code = DEPLOY.main(["--source", str(self.source), "--revision", REVISION, *extra], environ=self.environment if environment is None else environment, ssh_backend=fake.backend, socket_factory=fake.socket_factory)
        return code, out.getvalue(), err.getvalue(), fake

    def hosting_fake(self, **kwargs):
        fake = FakeSSH(**kwargs)
        for name in ("index.html", "sw.js"):
            fake.storage[f"/account/public_html/{name}"] = b"existing production file"
        return fake

    def assert_read_only(self, fake):
        writes = {"mkdir", "putfo", "posix_rename", "rename", "remove", "unlink", "rmdir"}
        self.assertFalse(any(event[0] in writes for event in fake.events))

    def test_check_connection_inspects_existing_regular_files_without_any_write(self):
        fake = self.hosting_fake()
        old_storage, old_directories = dict(fake.storage), set(fake.dirs)
        code, out, err, _ = self.main(fake=fake, extra=("--check-connection",))
        self.assertEqual(code, 0)
        self.assertIn("read-only connection check OK", out)
        self.assertEqual(err, "")
        self.assertEqual([event[1] for event in fake.events if event[0] == "stat"], ["/account/public_html/index.html", "/account/public_html/sw.js"])
        self.assertEqual(fake.storage, old_storage)
        self.assertEqual(fake.dirs, old_directories)
        self.assert_read_only(fake)

    def test_check_connection_missing_required_file_fails_without_any_write(self):
        for name in ("index.html", "sw.js"):
            with self.subTest(name=name):
                fake = self.hosting_fake()
                del fake.storage[f"/account/public_html/{name}"]
                code, out, err, _ = self.main(fake=fake, extra=("--check-connection",))
                self.assertEqual(code, 1)
                self.assertEqual(out, "")
                self.assertIn("missing index.html or sw.js", err)
                self.assert_read_only(fake)

    def test_check_connection_rejects_nonregular_files_without_any_write(self):
        for name in ("index.html", "sw.js"):
            with self.subTest(name=name):
                fake = self.hosting_fake()
                fake.file_modes[f"/account/public_html/{name}"] = stat.S_IFDIR | 0o755
                code, _, err, _ = self.main(fake=fake, extra=("--check-connection",))
                self.assertEqual(code, 1)
                self.assertIn("must be regular files", err)
                self.assert_read_only(fake)

    def test_check_connection_rejects_file_resolving_outside_webroot(self):
        fake = self.hosting_fake()
        original_normalize = fake.normalize
        fake.normalize = lambda path: "/private/index.html" if path.endswith("/index.html") else original_normalize(path)
        code, _, err, _ = self.main(fake=fake, extra=("--check-connection",))
        self.assertEqual(code, 1)
        self.assertIn("outside its expected path", err)
        self.assert_read_only(fake)

    def test_check_connection_never_creates_missing_webroot(self):
        fake = self.hosting_fake()
        fake.dirs.remove("/account/public_html")
        code, _, _, _ = self.main(fake=fake, extra=("--check-connection",))
        self.assertEqual(code, 1)
        self.assert_read_only(fake)

    def test_check_connection_root_still_requires_explicit_scoped_account(self):
        fake = self.hosting_fake(root="/")
        code, _, _, _ = self.main(fake=fake, environment={**self.environment, "DEPLOY_REMOTE_DIR": "/"}, extra=("--check-connection",))
        self.assertEqual(code, 1)
        self.assertEqual(fake.events, [])
        fake = self.hosting_fake(root="/")
        fake.storage["/index.html"], fake.storage["/sw.js"] = b"index", b"sw"
        code, _, err, _ = self.main(fake=fake, environment={**self.environment, "DEPLOY_REMOTE_DIR": "/", "DEPLOY_ALLOW_SCOPED_ROOT": "true"}, extra=("--check-connection",))
        self.assertEqual(code, 0, err)
        self.assert_read_only(fake)

    def test_check_connection_requires_matching_host_key_before_password(self):
        fake = self.hosting_fake()
        fake.server_wire = KEY_WIRE + b"changed"
        code, _, err, _ = self.main(fake=fake, extra=("--check-connection",))
        self.assertEqual(code, 1)
        self.assertIn("host key does not match", err)
        self.assertFalse(any(event[0] == "auth_password" for event in fake.events))
        self.assert_read_only(fake)
        environment = {**self.environment, "FTP_KNOWN_HOSTS": ""}
        code, _, _, fake = self.main(environment=environment, extra=("--check-connection",))
        self.assertEqual(code, 1)
        self.assertEqual(fake.events, [])

    def test_check_connection_and_dry_run_are_mutually_exclusive(self):
        fake = self.hosting_fake()
        with self.assertRaises(SystemExit) as raised:
            self.main(fake=fake, extra=("--check-connection", "--dry-run"))
        self.assertEqual(raised.exception.code, 2)
        self.assertEqual(fake.events, [])

    def test_sftp_222_verifies_host_key_before_password_and_opens_channel_after_authentication(self):
        fake = FakeSSH()
        self.deploy(fake)
        methods = [event[0] for event in fake.events]
        self.assertLess(methods.index("start_client"), methods.index("get_remote_server_key"))
        self.assertLess(methods.index("get_remote_server_key"), methods.index("auth_password"))
        self.assertLess(methods.index("auth_password"), methods.index("SFTPClient.from_transport"))
        self.assertEqual(fake.security.key_types, ("ssh-ed25519",))
        self.assertIn(("connect", ("ftp.insertcreator.com", 222), 30), fake.events)
        self.assertIn(("auth_password", "private-user", "private-password", False), fake.events)
        self.assertIn(("channel.settimeout", 30), fake.events)

    def test_wrong_host_key_or_type_never_sends_credentials(self):
        for field, value in (("server_wire", KEY_WIRE + b"changed"), ("server_type", "ssh-rsa")):
            with self.subTest(field=field):
                fake = FakeSSH()
                setattr(fake, field, value)
                code, _, err, _ = self.main(fake=fake)
                self.assertEqual(code, 1)
                self.assertIn("host key does not match", err)
                self.assertFalse(any(event[0] in ("auth_password", "putfo") for event in fake.events))

    def test_rsa_pin_negotiates_only_existing_sha2_algorithms(self):
        key_type = "ssh-rsa"
        wire = len(key_type).to_bytes(4, "big") + key_type.encode() + b"test key material"
        fake = FakeSSH()
        fake.server_wire, fake.server_type = wire, key_type
        environment = {**self.environment, "FTP_KNOWN_HOSTS": "[ftp.insertcreator.com]:222 ssh-rsa " + base64.b64encode(wire).decode()}
        code, _, _, _ = self.main(environment=environment, fake=fake)
        self.assertEqual(code, 0)
        self.assertEqual(fake.security.key_types, ("rsa-sha2-512", "rsa-sha2-256"))

    def test_missing_or_invalid_pins_fail_before_connection(self):
        bad_values = ("", KNOWN_HOSTS.replace(":222", ":22"), KNOWN_HOSTS.replace("ftp.insertcreator.com", "other.example"), KNOWN_HOSTS.rsplit(" ", 1)[0] + " !!!!", "[ftp.insertcreator.com]:222 ssh-ed25519 " + base64.b64encode(b"invalid wire").decode(), "|hashed|host ssh-ed25519 AAAA")
        for value in bad_values:
            with self.subTest(value=value):
                environment = {**self.environment, "FTP_KNOWN_HOSTS": value}
                code, _, err, fake = self.main(environment=environment)
                self.assertEqual(code, 1)
                self.assertIn("FTP_KNOWN_HOSTS", err)
                self.assertEqual(fake.events, [])

    def test_all_files_are_staged_before_activation_and_marker_is_last(self):
        fake = FakeSSH()
        self.deploy(fake)
        methods = [event[0] for event in fake.events]
        self.assertLess(max(i for i, method in enumerate(methods) if method == "putfo"), methods.index("posix_rename"))
        self.assertLess(max(i for i, method in enumerate(methods) if method == "stat"), methods.index("posix_rename"))
        targets = [event[2] for event in fake.events if event[0] == "posix_rename"]
        self.assertEqual(targets[-3:], ["/account/public_html/index.html", "/account/public_html/sw.js", "/account/public_html/deployment.json"])
        self.assertEqual(fake.storage["/account/public_html/vendor/library.js"], b"library\x00bytes")
        for event in fake.events:
            if event[0] == "putfo":
                self.assertIn(f".insertcreator-{REVISION}.upload", event[1])
                self.assertTrue(event[3])

    def test_preserves_unknown_files_and_hosting_configuration(self):
        (self.source / ".htaccess").write_text("never upload", encoding="utf-8")
        fake = FakeSSH()
        self.deploy(fake)
        self.assertEqual(fake.storage["/account/public_html/.htaccess"], b"hosting config")
        self.assertEqual(fake.storage["/account/public_html/unknown.txt"], b"leave me")
        self.assertFalse(any(event[0] in ("remove", "unlink", "rmdir") for event in fake.events))
        self.assertFalse(any(".htaccess" in str(event) for event in fake.events))

    def test_unsupported_posix_extension_uses_standard_rename_without_deletion(self):
        fake = FakeSSH(unsupported_rename=True)
        self.deploy(fake)
        self.assertIn("/account/public_html/deployment.json", fake.storage)
        self.assertEqual(sum(event[0] == "rename" for event in fake.events), 5)
        self.assertFalse(any(event[0] in ("remove", "unlink") for event in fake.events))

    def test_standard_rename_existing_target_fails_without_removing_old_file(self):
        fake = FakeSSH(unsupported_rename=True)
        fake.storage["/account/public_html/app.js"] = b"old app"
        code, _, err, _ = self.main(fake=fake)
        self.assertEqual(code, 1)
        self.assertIn("activating files", err)
        self.assertEqual(fake.storage["/account/public_html/app.js"], b"old app")
        self.assertNotIn("/account/public_html/deployment.json", fake.storage)

    def test_permission_error_on_posix_rename_is_not_treated_as_missing_extension(self):
        fake = FakeSSH(failure="posix_rename")
        code, _, _, _ = self.main(fake=fake)
        self.assertEqual(code, 1)
        self.assertFalse(any(event[0] == "rename" for event in fake.events))

    def test_manifest_identifies_exact_snapshotted_bytes(self):
        plan = self.plan()
        (self.source / "app.js").write_text("changed after plan", encoding="utf-8")
        marker = json.loads(plan.manifest.data)
        self.assertEqual(marker["revision"], REVISION)
        self.assertEqual(marker["schemaVersion"], 1)
        self.assertEqual(marker["fileCount"], len(plan.files))
        self.assertEqual(marker["totalBytes"], sum(len(file.data) for file in plan.files))
        for file, record in zip(plan.files, marker["files"]):
            self.assertEqual(record, {"path": file.path, "size": len(file.data), "sha256": hashlib.sha256(file.data).hexdigest()})
        self.assertEqual(next(file.data for file in plan.files if file.path == "app.js"), b"// new app")

    def test_dry_run_needs_no_host_secrets_dependency_or_connection(self):
        code, out, err, fake = self.main(environment={}, extra=("--dry-run",))
        self.assertEqual(code, 0)
        self.assertIn("Dry run OK", out)
        self.assertEqual(err, "")
        self.assertEqual(fake.events, [])

    def test_missing_secrets_stop_before_connection(self):
        for missing in self.environment:
            with self.subTest(missing=missing):
                environment = dict(self.environment)
                del environment[missing]
                code, out, err, fake = self.main(environment=environment)
                self.assertEqual(code, 1)
                self.assertEqual(out, "")
                self.assertEqual(fake.events, [])
                self.assertNotIn("private-password", err)
                self.assertNotIn("private-user", err)

    def test_server_errors_never_leak_secrets_or_activate_early(self):
        for failure in ("start_client", "auth_password", "putfo"):
            with self.subTest(failure=failure):
                fake = FakeSSH(failure=failure)
                code, out, err, _ = self.main(fake=fake)
                self.assertEqual(code, 1)
                self.assertNotIn("private-user", out + err)
                self.assertNotIn("private-password", out + err)
                self.assertFalse(any(event[0] == "posix_rename" for event in fake.events))
                self.assertEqual(fake.events[-1], ("socket.close",))
                if failure == "start_client":
                    self.assertFalse(any(event[0] == "auth_password" for event in fake.events))

    def test_wrong_size_prevents_all_activation(self):
        fake = FakeSSH(tamper_size=True)
        with self.assertRaisesRegex(DEPLOY.DeploymentError, "unexpected size"):
            self.deploy(fake)
        self.assertFalse(any(event[0] == "posix_rename" for event in fake.events))

    def test_root_is_rejected_unless_account_scope_is_explicit(self):
        for remote in ("/", "."):
            with self.subTest(remote=remote), self.assertRaises(DEPLOY.DeploymentError):
                DEPLOY.validate_remote_dir(remote)
        fake = FakeSSH(root="/")
        self.deploy(fake, remote_dir="/", allow_scoped_root=True)
        self.assertIn("/deployment.json", fake.storage)
        fake = FakeSSH(root="/")
        fake.dirs.add("/public_html")
        original_normalize = fake.normalize
        fake.normalize = lambda path: "/" if fake.current == "/public_html" else original_normalize(path)
        with self.assertRaisesRegex(DEPLOY.DeploymentError, "server root"):
            self.deploy(fake)
        self.assertFalse(any(event[0] == "putfo" for event in fake.events))

    def test_directory_that_resolves_outside_expected_path_is_rejected(self):
        fake = FakeSSH()
        original_normalize = fake.normalize
        fake.normalize = lambda path: "/other" if fake.current.endswith("/vendor") else original_normalize(path)
        with self.assertRaisesRegex(DEPLOY.DeploymentError, "outside"):
            self.deploy(fake)
        self.assertFalse(any(event[0] == "putfo" for event in fake.events))

    def test_unsafe_paths_and_hosts_are_rejected(self):
        for path in ("../public_html", "public_html/../other", "public_html\nUSER test", "", "public_html//x", "public_html\\x"):
            with self.subTest(path=path), self.assertRaises(DEPLOY.DeploymentError):
                DEPLOY.validate_remote_dir(path)
        for path in ("../secret", "/secret", "a/../b", "a//b", "a\r\nPASS b", "a\\b"):
            with self.subTest(path=path), self.assertRaises(DEPLOY.DeploymentError):
                DEPLOY.validate_relative_path(path)
        for host in ("sftp://example.com", "example.com:222", "host\nUSER test", "host/path"):
            with self.subTest(host=host), self.assertRaises(DEPLOY.DeploymentError):
                DEPLOY.deploy(self.plan(), host=host, username="x", password="x", known_hosts=KNOWN_HOSTS)

    def test_credential_control_delimiters_are_rejected_before_connection(self):
        fake = FakeSSH()
        with self.assertRaises(DEPLOY.DeploymentError):
            DEPLOY.deploy(self.plan(), host="example.com", username="x\nUSER other", password="p", known_hosts=KNOWN_HOSTS, ssh_backend=fake.backend, socket_factory=fake.socket_factory)
        self.assertEqual(fake.events, [])

    def test_invalid_package_and_revision_fail_closed(self):
        for revision in ("main", "abc123", REVISION + "\n", "g" * 40, "a" * 64):
            with self.subTest(revision=revision), self.assertRaises(DEPLOY.DeploymentError):
                DEPLOY.build_plan(self.source, revision)
        (self.source / "sw.js").unlink()
        with self.assertRaisesRegex(DEPLOY.DeploymentError, "index.html and sw.js"):
            self.plan()

    def test_hidden_files_and_prebuilt_marker_are_rejected(self):
        for name in (".env", "deployment.json"):
            with self.subTest(name=name):
                path = self.source / name
                path.write_text("not deployable", encoding="utf-8")
                with self.assertRaises(DEPLOY.DeploymentError):
                    self.plan()
                path.unlink()

    def test_symlinks_are_rejected(self):
        link = self.source / "linked.js"
        try:
            link.symlink_to(self.source / "app.js")
        except OSError:
            self.skipTest("Creating symlinks is unavailable for this Windows account.")
        with self.assertRaisesRegex(DEPLOY.DeploymentError, "symbolic links"):
            self.plan()

    def test_source_and_descendant_junctions_are_rejected(self):
        for junction in (self.source, self.source / "vendor"):
            with self.subTest(junction=junction):
                target = junction.resolve()
                with patch.object(Path, "is_junction", lambda path: path.resolve() == target, create=True):
                    with self.assertRaises(DEPLOY.DeploymentError):
                        self.plan()

    def test_regular_file_must_resolve_within_source_directory(self):
        original_resolve = Path.resolve
        escaped_file = self.source / "vendor" / "library.js"
        resolved_file = escaped_file.resolve()

        def resolve(path, *args, **kwargs):
            if path in (escaped_file, resolved_file):
                return Path(self.temporary.name) / "private-file.js"
            return original_resolve(path, *args, **kwargs)

        with patch.object(Path, "resolve", resolve):
            with self.assertRaisesRegex(DEPLOY.DeploymentError, "outside the source"):
                self.plan()


if __name__ == "__main__":
    unittest.main()
