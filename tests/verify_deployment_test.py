"""Offline tests for HTTPS release verification; no production requests or credentials."""

import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import ssl
import sys
import tempfile
import unittest
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlsplit
from urllib.request import Request


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "verify_deployment.py"
SPEC = importlib.util.spec_from_file_location("verify_deployment", SCRIPT)
verify = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = verify
SPEC.loader.exec_module(verify)
DEPLOY_SPEC = importlib.util.spec_from_file_location("deploy_static_verifier_contract", SCRIPT.with_name("deploy_static.py"))
deploy = importlib.util.module_from_spec(DEPLOY_SPEC)
sys.modules[DEPLOY_SPEC.name] = deploy
DEPLOY_SPEC.loader.exec_module(deploy)
REVISION = "a" * 40
BASE_URL = "https://insertcreator.com"


class FakeTransport:
    def __init__(self, payloads):
        self.payloads = payloads
        self.requests = []

    def fetch(self, url, max_bytes):
        parsed = urlsplit(url)
        path = unquote(parsed.path.lstrip("/"))
        self.requests.append((url, max_bytes))
        if path not in self.payloads:
            raise verify.VerificationError("HTTP request failed with status 404.")
        payload = self.payloads[path]
        if len(payload) > max_bytes:
            raise verify.VerificationError("HTTP response exceeds the expected size limit.")
        return payload


class DeploymentVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name)
        self.payloads = {"index.html": b"<html>tested</html>", "sw.js": b"// worker", "assets/a #%.wasm": b"\x00\x01\xff"}
        for path, data in self.payloads.items():
            file = self.source / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
        self.marker = {
            "schemaVersion": 1,
            "revision": REVISION,
            "generatedAt": "2026-11-04T12:00:00Z",
            "fileCount": len(self.payloads),
            "totalBytes": sum(map(len, self.payloads.values())),
            "files": [{"path": path, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()} for path, data in self.payloads.items()],
        }

    def transport(self, marker=None):
        return FakeTransport({**self.payloads, "deployment.json": json.dumps(marker or self.marker).encode()})

    def run_verification(self, transport):
        return verify.verify_deployment(BASE_URL, REVISION, self.source, fetcher=transport)

    def test_complete_release_verifies_every_file_and_cache_busts(self):
        transport = self.transport()
        self.assertEqual(self.run_verification(transport), (3, sum(map(len, self.payloads.values()))))
        self.assertEqual(len(transport.requests), 4)
        for url, _ in transport.requests:
            self.assertTrue(urlsplit(url).query.startswith("insertcreator_verify=" + REVISION + "-"))
            self.assertEqual(urlsplit(url).fragment, "")
        self.assertTrue(any("a%20%23%25.wasm" in url for url, _ in transport.requests))

    def test_uploader_generated_manifest_and_snapshot_satisfy_verifier_contract(self):
        (self.source / ".htaccess").write_text("hosting configuration", encoding="utf-8")
        (self.source / "assets" / ".htaccess").write_text("hosting configuration", encoding="utf-8")
        plan = deploy.build_plan(self.source, REVISION.upper())
        payloads = {file.path: file.data for file in plan.files}
        payloads[plan.manifest.path] = plan.manifest.data
        self.assertEqual(self.run_verification(FakeTransport(payloads)), (3, sum(map(len, self.payloads.values()))))
        self.assertEqual(plan.revision, REVISION)

    def test_wrong_revision_stops_before_fetching_assets(self):
        marker = copy.deepcopy(self.marker)
        marker["revision"] = "b" * 40
        transport = self.transport(marker)
        with self.assertRaisesRegex(verify.VerificationError, "revision"):
            self.run_verification(transport)
        self.assertEqual(len(transport.requests), 1)

    def test_corrupted_served_file_fails_even_when_marker_is_correct(self):
        transport = self.transport()
        transport.payloads["sw.js"] = b"// broken"
        with self.assertRaisesRegex(verify.VerificationError, "sw.js"):
            self.run_verification(transport)

    def test_missing_served_file_fails(self):
        transport = self.transport()
        del transport.payloads["index.html"]
        with self.assertRaisesRegex(verify.VerificationError, "index.html:.*404"):
            self.run_verification(transport)

    def test_unexpected_or_missing_manifest_entries_fail(self):
        for change in ("unexpected", "missing", "duplicate", "hash", "size", "traversal", "boolean_count"):
            with self.subTest(change=change):
                marker = copy.deepcopy(self.marker)
                if change == "unexpected":
                    marker["files"][0]["path"] = "unknown.js"
                elif change == "missing":
                    marker["files"].pop()
                elif change == "duplicate":
                    marker["files"][0] = marker["files"][1]
                elif change == "hash":
                    marker["files"][0]["sha256"] = "0" * 64
                elif change == "size":
                    marker["files"][0]["size"] = True
                elif change == "traversal":
                    marker["files"][0]["path"] = "../secret"
                else:
                    marker["fileCount"] = True
                with self.assertRaises(verify.VerificationError):
                    self.run_verification(self.transport(marker))

    def test_marker_is_excluded_from_its_own_file_list(self):
        (self.source / "deployment.json").write_text("local generated metadata", encoding="utf-8")
        self.assertEqual(self.run_verification(self.transport())[0], 3)

    def test_hosting_configuration_is_preserved_and_excluded(self):
        (self.source / ".htaccess").write_text("hosting configuration", encoding="utf-8")
        (self.source / "assets" / ".htaccess").write_text("hosting configuration", encoding="utf-8")
        self.assertEqual(self.run_verification(self.transport())[0], 3)

    def test_duplicate_json_keys_are_rejected(self):
        transport = self.transport()
        transport.payloads["deployment.json"] = b'{"schemaVersion":1,"schemaVersion":1}'
        with self.assertRaisesRegex(verify.VerificationError, "duplicate JSON key"):
            self.run_verification(transport)

    def test_source_requires_entrypoint_and_service_worker(self):
        (self.source / "sw.js").unlink()
        with self.assertRaisesRegex(verify.VerificationError, "index.html, sw.js"):
            self.run_verification(self.transport())

    def test_symbolic_link_is_rejected(self):
        link = self.source / "linked.js"
        try:
            link.symlink_to(self.source / "sw.js")
        except OSError:
            self.skipTest("Creating symbolic links is unavailable in this environment.")
        with self.assertRaisesRegex(verify.VerificationError, "Symbolic links"):
            self.run_verification(self.transport())


class URLAndTransportTests(unittest.TestCase):
    def test_revision_requires_the_full_supported_commit_sha(self):
        self.assertEqual(verify.validate_revision(REVISION.upper()), REVISION)
        for revision in ("a" * 7, "a" * 64, "g" * 40, "a" * 39 + "\n"):
            with self.subTest(revision=revision), self.assertRaises(verify.VerificationError):
                verify.validate_revision(revision)

    def test_base_url_rejects_queries_fragments_http_credentials_and_traversal(self):
        for url in (
            "http://insertcreator.com", "https://insertcreator.com?x=1", "https://insertcreator.com/#x",
            "https://user:password@insertcreator.com", "https://insertcreator.com/../private",
            "https://insertcreator.com/%2e%2e/private", "https://insertcreator.com:0", "https://insertcreator.com:99999",
            "https://insertcreator.com\\@attacker.example", "https://insertcreator.com/\n",
            "https://insertcreator.com%3a443",
        ):
            with self.subTest(url=url), self.assertRaises(verify.VerificationError):
                verify.URLPolicy(url)

    def test_redirects_allow_only_the_same_https_origin(self):
        policy = verify.URLPolicy(BASE_URL)
        handler = verify.SameOriginRedirectHandler(policy)
        request = Request(BASE_URL + "/index.html")
        result = handler.redirect_request(request, None, 302, "Found", {}, BASE_URL + "/index.html?x=1")
        self.assertEqual(result.full_url, BASE_URL + "/index.html?x=1")
        for url in (
            "http://insertcreator.com/index.html", "https://other.example/index.html",
            "https://insertcreator.com:444/index.html", "https://user@insertcreator.com/index.html",
        ):
            with self.subTest(url=url), self.assertRaises(verify.VerificationError):
                handler.redirect_request(request, None, 302, "Found", {}, url)

    def test_bounded_reader_rejects_oversized_responses(self):
        for declared in (None, "100"):
            with self.subTest(content_length=declared):
                opener = FakeOpener([FakeResponse(b"12345", content_length=declared)])
                fetcher = verify.HTTPSFetcher(verify.URLPolicy(BASE_URL), opener=opener)
                with self.assertRaisesRegex(verify.VerificationError, "size limit"):
                    fetcher.fetch(BASE_URL + "/sw.js", 4)

    def test_non_200_success_response_is_not_a_public_file(self):
        opener = FakeOpener([FakeResponse(b"", status=204)])
        fetcher = verify.HTTPSFetcher(verify.URLPolicy(BASE_URL), opener=opener)
        with self.assertRaisesRegex(verify.VerificationError, "HTTP 200"):
            fetcher.fetch(BASE_URL + "/sw.js", 0)

    def test_transient_http_failure_retries_but_404_and_tls_errors_do_not(self):
        url = BASE_URL + "/sw.js"
        delays = []
        opener = FakeOpener([HTTPError(url, 503, "Unavailable", {}, None), FakeResponse(b"ok")])
        fetcher = verify.HTTPSFetcher(verify.URLPolicy(BASE_URL), opener=opener, sleep=delays.append)
        self.assertEqual(fetcher.fetch(url, 2), b"ok")
        self.assertEqual(delays, [0.5])
        for error in (HTTPError(url, 404, "Missing", {}, None), URLError(ssl.SSLCertVerificationError("invalid certificate"))):
            with self.subTest(error=type(error).__name__):
                opener = FakeOpener([error, FakeResponse(b"ok")])
                fetcher = verify.HTTPSFetcher(verify.URLPolicy(BASE_URL), opener=opener, sleep=lambda _: self.fail("Unexpected retry"))
                with self.assertRaises(verify.VerificationError):
                    fetcher.fetch(url, 2)
                self.assertEqual(opener.calls, 1)

    def test_final_response_url_is_checked_even_with_a_custom_opener(self):
        opener = FakeOpener([FakeResponse(b"ok", url="https://other.example/sw.js")])
        fetcher = verify.HTTPSFetcher(verify.URLPolicy(BASE_URL), opener=opener)
        with self.assertRaisesRegex(verify.VerificationError, "origin"):
            fetcher.fetch(BASE_URL + "/sw.js", 2)


class FakeResponse(io.BytesIO):
    def __init__(self, data, *, url=BASE_URL + "/sw.js", content_length=None, status=200):
        super().__init__(data)
        self.url = url
        self.status = status
        self.headers = {} if content_length is None else {"Content-Length": content_length}

    def geturl(self):
        return self.url


class FakeOpener:
    def __init__(self, outcomes):
        self.outcomes = iter(outcomes)
        self.calls = 0

    def open(self, request, timeout):
        self.calls += 1
        result = next(self.outcomes)
        if isinstance(result, Exception):
            raise result
        return result


if __name__ == "__main__":
    unittest.main()
