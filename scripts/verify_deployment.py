#!/usr/bin/env python3
"""Verify a static InsertCreator release over HTTPS using only the standard library."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta
import errno
import hashlib
from http.client import HTTPException, IncompleteRead
import json
from pathlib import Path, PurePosixPath
import re
import socket
import ssl
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener
import uuid


MAX_FILES = 10_000
MAX_FILE_BYTES = 128 * 1024 * 1024
MAX_TOTAL_BYTES = 1024 * 1024 * 1024
MAX_MARKER_BYTES = 4 * 1024 * 1024
REVISION_RE = re.compile(r"[0-9a-fA-F]{40}\Z")
HASH_RE = re.compile(r"[0-9a-f]{64}\Z")


class VerificationError(Exception):
    """A configuration, integrity, or HTTP verification failure."""


def validate_revision(revision: str) -> str:
    if not isinstance(revision, str) or not REVISION_RE.fullmatch(revision):
        raise VerificationError("Revision must be a full 40-character Git commit SHA.")
    return revision.lower()


def validate_path(path: str) -> str:
    if (
        not isinstance(path, str)
        or not path
        or "\\" in path
        or any(ord(character) < 32 or ord(character) == 127 for character in path)
        or PurePosixPath(path).is_absolute()
        or any(part in ("", ".", "..") for part in path.split("/"))
    ):
        raise VerificationError("Invalid public file path.")
    return path


class URLPolicy:
    """Only HTTPS requests and redirects to the configured origin are allowed."""

    def __init__(self, base_url: str):
        parsed = self._parse(base_url)
        if parsed.query or parsed.fragment:
            raise VerificationError("The website URL must not contain a query or fragment.")
        if "%" in parsed.path or "\\" in parsed.path:
            raise VerificationError("The website URL must use a plain directory path.")
        if parsed.path not in ("", "/"):
            validate_path(parsed.path.strip("/"))
        self.origin = (parsed.hostname.lower(), parsed.port or 443)
        self.base_url = urlunsplit(("https", parsed.netloc, parsed.path.rstrip("/") + "/", "", ""))

    @staticmethod
    def _parse(url: str):
        if not isinstance(url, str) or any(ord(character) <= 32 or ord(character) == 127 for character in url):
            raise VerificationError("Invalid HTTPS website URL.")
        try:
            parsed = urlsplit(url)
            if (
                parsed.scheme.lower() != "https"
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or "\\" in parsed.netloc
                or "%" in parsed.netloc
                or parsed.port == 0
            ):
                raise ValueError
            parsed.hostname.encode("ascii")
            # Access the port now so malformed or out-of-range ports are rejected.
            parsed.port
        except (ValueError, UnicodeError):
            raise VerificationError("Use an HTTPS website URL without credentials.") from None
        return parsed

    def validate_remote(self, url: str) -> None:
        parsed = self._parse(url)
        if (parsed.hostname.lower(), parsed.port or 443) != self.origin:
            raise VerificationError("An HTTP redirect left the configured HTTPS origin.")
        if parsed.fragment:
            raise VerificationError("HTTP redirects must not contain a fragment.")

    def file_url(self, path: str, cache_token: str) -> str:
        validate_path(path)
        encoded_path = "/".join(quote(part, safe="") for part in path.split("/"))
        return self.base_url + encoded_path + "?insertcreator_verify=" + quote(cache_token, safe="")


class SameOriginRedirectHandler(HTTPRedirectHandler):
    def __init__(self, policy: URLPolicy):
        super().__init__()
        self.policy = policy

    def redirect_request(self, request, response, code, message, headers, new_url):
        self.policy.validate_remote(new_url)
        return super().redirect_request(request, response, code, message, headers, new_url)


def _is_transient(error: BaseException) -> bool:
    if isinstance(error, HTTPError):
        return error.code in (408, 425, 429, 500, 502, 503, 504)
    reason = error.reason if isinstance(error, URLError) else error
    if isinstance(reason, ssl.SSLError):
        return False
    if isinstance(reason, (TimeoutError, ConnectionError, IncompleteRead)):
        return True
    if isinstance(reason, socket.gaierror):
        return reason.errno == socket.EAI_AGAIN
    return isinstance(reason, OSError) and reason.errno in (
        errno.ETIMEDOUT, errno.ECONNRESET, errno.ECONNREFUSED, errno.ECONNABORTED,
        errno.ENETUNREACH, errno.EHOSTUNREACH,
    )


class HTTPSFetcher:
    def __init__(self, policy: URLPolicy, *, timeout: float = 15, attempts: int = 3, opener=None, sleep=time.sleep):
        self.policy = policy
        self.timeout = timeout
        self.attempts = attempts
        context = ssl.create_default_context()
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        self.opener = opener or build_opener(SameOriginRedirectHandler(policy), HTTPSHandler(context=context))
        self.sleep = sleep

    def fetch(self, url: str, max_bytes: int) -> bytes:
        self.policy.validate_remote(url)
        request = Request(url, headers={
            "Cache-Control": "no-cache, no-store",
            "Pragma": "no-cache",
            "Accept-Encoding": "identity",
            "User-Agent": "InsertCreator-deployment-verifier/1",
        })
        for attempt in range(self.attempts):
            try:
                with self.opener.open(request, timeout=self.timeout) as response:
                    self.policy.validate_remote(response.geturl())
                    if response.status != 200:
                        raise VerificationError("The server did not return HTTP 200 for a public file.")
                    length = response.headers.get("Content-Length")
                    if length is not None:
                        try:
                            declared_length = int(length)
                        except ValueError:
                            raise VerificationError("HTTP response has an invalid content length.") from None
                        if declared_length < 0 or declared_length > max_bytes:
                            raise VerificationError("HTTP response exceeds the expected size limit.")
                    chunks = []
                    count = 0
                    while True:
                        chunk = response.read(min(64 * 1024, max_bytes - count + 1))
                        if not chunk:
                            return b"".join(chunks)
                        count += len(chunk)
                        if count > max_bytes:
                            raise VerificationError("HTTP response exceeds the expected size limit.")
                        chunks.append(chunk)
            except (HTTPError, URLError, OSError, HTTPException) as error:
                if isinstance(error, HTTPError):
                    error.close()
                if attempt + 1 < self.attempts and _is_transient(error):
                    self.sleep(0.5 * (2 ** attempt))
                    continue
                if isinstance(error, HTTPError):
                    raise VerificationError(f"HTTP request failed with status {error.code}.") from None
                raise VerificationError("HTTPS request failed; check connectivity and the server certificate.") from None
        raise VerificationError("HTTPS request failed.")


@dataclass(frozen=True)
class PublicFile:
    path: str
    size: int
    sha256: str


def collect_source(source: Path) -> dict[str, PublicFile]:
    source = Path(source)
    if source.is_symlink() or (hasattr(source, "is_junction") and source.is_junction()) or not source.is_dir():
        raise VerificationError("Source must be an existing directory, not a symbolic link.")
    files = {}
    total_bytes = 0
    for item in sorted(source.rglob("*")):
        if item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()):
            raise VerificationError("Symbolic links and junctions are not allowed in the public source.")
        path = validate_path(item.relative_to(source).as_posix())
        if ".htaccess" in path.split("/"):
            # Match the uploader: hosting configuration is maintained separately.
            continue
        if any(part.startswith(".") for part in path.split("/")):
            raise VerificationError("Hidden files and directories are not allowed in the public source.")
        if item.is_dir():
            continue
        if not item.is_file():
            raise VerificationError("The public source contains a non-regular file.")
        if path == "deployment.json":
            continue
        size = item.stat().st_size
        total_bytes += size
        if size > MAX_FILE_BYTES or total_bytes > MAX_TOTAL_BYTES or len(files) >= MAX_FILES:
            raise VerificationError("The public source exceeds verification size limits.")
        digest = hashlib.sha256()
        with item.open("rb") as stream:
            for chunk in iter(lambda: stream.read(64 * 1024), b""):
                digest.update(chunk)
        files[path] = PublicFile(path, size, digest.hexdigest())
    if not files or "index.html" not in files or "sw.js" not in files:
        raise VerificationError("Source must include index.html, sw.js, and the complete static release.")
    return files


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise VerificationError("Deployment marker contains a duplicate JSON key.")
        result[key] = value
    return result


def validate_marker(data: bytes, revision: str, files: dict[str, PublicFile]) -> None:
    try:
        marker = json.loads(data.decode("utf-8"), object_pairs_hook=_unique_object)
    except (UnicodeError, ValueError):
        raise VerificationError("Deployment marker is not valid UTF-8 JSON.") from None
    if not isinstance(marker, dict) or type(marker.get("schemaVersion")) is not int or marker["schemaVersion"] != 1:
        raise VerificationError("Unsupported deployment marker schema.")
    if marker.get("revision") != revision:
        raise VerificationError("Deployed revision does not match the tested commit.")
    try:
        generated_at = datetime.fromisoformat(marker["generatedAt"].replace("Z", "+00:00"))
        if generated_at.utcoffset() != timedelta(0):
            raise ValueError
    except (KeyError, AttributeError, TypeError, ValueError):
        raise VerificationError("Deployment marker must include a UTC generation timestamp.") from None
    expected_total = sum(file.size for file in files.values())
    if (
        type(marker.get("fileCount")) is not int or marker["fileCount"] != len(files)
        or type(marker.get("totalBytes")) is not int or marker["totalBytes"] != expected_total
    ):
        raise VerificationError("Deployment marker file counts or total size do not match the tested source.")
    entries = marker.get("files")
    if not isinstance(entries, list) or len(entries) != len(files):
        raise VerificationError("Deployment marker file list does not match the tested source.")
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise VerificationError("Deployment marker contains an invalid file entry.")
        path = validate_path(entry.get("path"))
        if path in seen or path not in files:
            raise VerificationError("Deployment marker contains duplicate or unexpected public files.")
        seen.add(path)
        expected = files[path]
        digest = entry.get("sha256")
        if (
            type(entry.get("size")) is not int or entry["size"] != expected.size
            or not isinstance(digest, str) or not HASH_RE.fullmatch(digest) or digest != expected.sha256
        ):
            raise VerificationError(f"Deployment marker differs from the tested source: {path}")


def verify_deployment(url: str, revision: str, source: Path, *, fetcher=None, workers: int = 6) -> tuple[int, int]:
    revision = validate_revision(revision)
    policy = URLPolicy(url)
    files = collect_source(source)
    transport = fetcher or HTTPSFetcher(policy)
    cache_token = revision + "-" + uuid.uuid4().hex
    marker = transport.fetch(policy.file_url("deployment.json", cache_token), MAX_MARKER_BYTES)
    validate_marker(marker, revision, files)

    def verify_file(file: PublicFile):
        try:
            data = transport.fetch(policy.file_url(file.path, cache_token), file.size)
            if len(data) != file.size or hashlib.sha256(data).hexdigest() != file.sha256:
                raise VerificationError("The served file differs from the tested source.")
        except VerificationError as error:
            raise VerificationError(f"{file.path}: {error}") from None

    errors = []
    with ThreadPoolExecutor(max_workers=max(1, min(6, workers))) as executor:
        futures = [executor.submit(verify_file, file) for file in files.values()]
        for future in as_completed(futures):
            try:
                future.result()
            except VerificationError as error:
                errors.append(str(error))
    if errors:
        details = "; ".join(sorted(errors)[:5])
        raise VerificationError(f"{len(errors)} public file(s) failed verification. {details}")
    return len(files), sum(file.size for file in files.values())


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="HTTPS website URL, without query or fragment")
    parser.add_argument("--revision", required=True, help="Full tested Git commit SHA")
    parser.add_argument("--source", type=Path, default=Path("dist"), help="Tested public static directory")
    args = parser.parse_args(argv)
    try:
        count, total = verify_deployment(args.url, args.revision, args.source)
    except (VerificationError, OSError) as error:
        # Network exceptions are sanitized by HTTPSFetcher; local OS details need not enter CI logs.
        message = str(error) if isinstance(error, VerificationError) else "Unable to read the local release source."
        print(f"Deployment verification failed: {message}", file=sys.stderr)
        return 1
    print(f"Verified {count} public files ({total} bytes) for revision {args.revision.lower()}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
