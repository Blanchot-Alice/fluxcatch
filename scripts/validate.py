#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import json
import pathlib
import re
import subprocess
import sys
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parents[1]
EXT = ROOT / "extension"
PUBLIC_NAME = "FluxCatch"
PACKAGE_NAME = "fluxcatch"
LEGACY_SLUG = "mux" + "sift"
NATIVE_HOST_NAME = "io.github.blanchot_alice.fluxcatch"
HOST_TEMPLATE = ROOT / "native-host" / f"{NATIVE_HOST_NAME}.json.in"
PUBLIC_TEXT_SUFFIXES = {
    "", ".css", ".html", ".in", ".js", ".json", ".md", ".mjs", ".py", ".sh", ".txt", ".yml", ".yaml"
}
STRICT_FORBIDDEN_PUBLIC_NAMES = re.compile("|".join([
    "video" + r"[-_ ]?download[-_ ]?" + "helper",
    "stream" + "scout",
    "clean" + r"[-_ ]?" + "room",
    "lmjnegcaeklhafol" + "okijcfjliaokphfk",
]), re.IGNORECASE)
RETIRED_PUBLIC_BRAND = re.compile(LEGACY_SLUG, re.IGNORECASE)

LEGACY_BRAND_ALLOWLIST: dict[str, tuple[str, ...]] = {}


class AssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.assets: list[str] = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "script" and values.get("src"):
            self.assets.append(values["src"])
        if tag == "link" and values.get("href"):
            self.assets.append(values["href"])


def manifest_paths(manifest: dict) -> set[str]:
    paths = {
        manifest["background"]["service_worker"],
        manifest["action"]["default_popup"],
        manifest["options_page"],
        *manifest.get("icons", {}).values(),
    }
    for script in manifest.get("content_scripts", []):
        paths.update(script.get("js", []))
        paths.update(script.get("css", []))
    if manifest.get("side_panel", {}).get("default_path"):
        paths.add(manifest["side_panel"]["default_path"].split("?", 1)[0])
    return paths


def extension_id(public_key_b64: str) -> str:
    digest = hashlib.sha256(base64.b64decode(public_key_b64)).digest()[:16]
    return "".join(chr(ord("a") + (byte >> 4)) + chr(ord("a") + (byte & 15)) for byte in digest)


def public_name_leaks(relative: str, text: str) -> list[str]:
    leaks: list[str] = []
    for match in STRICT_FORBIDDEN_PUBLIC_NAMES.finditer(text):
        line = text.count("\n", 0, match.start()) + 1
        leaks.append(f"{relative}:{line}:{match.group(0)}")

    masked = text
    for token in LEGACY_BRAND_ALLOWLIST.get(relative, ()):
        masked = masked.replace(token, " " * len(token))
    for match in RETIRED_PUBLIC_BRAND.finditer(masked):
        line = masked.count("\n", 0, match.start()) + 1
        leaks.append(f"{relative}:{line}:retired-brand")
    return leaks


def main() -> int:
    manifest = json.loads((EXT / "manifest.json").read_text("utf-8"))
    package = json.loads((ROOT / "package.json").read_text("utf-8"))
    assert manifest["manifest_version"] == 3
    assert manifest["background"].get("type") == "module"
    if package.get("name") != PACKAGE_NAME or package.get("version") != manifest.get("version"):
        raise SystemExit("package.json name/version does not match the public release identity")
    if manifest.get("name") != PUBLIC_NAME or manifest.get("action", {}).get("default_title") != PUBLIC_NAME:
        raise SystemExit("Manifest public name does not match the FluxCatch release identity")
    host_source = (ROOT / "native-host/host.py").read_text("utf-8")
    version_match = re.search(r'^VERSION\s*=\s*["\']([^"\']+)["\']', host_source, re.MULTILINE)
    if not version_match or version_match.group(1) != manifest.get("version"):
        raise SystemExit("Native-host VERSION does not match manifest version")
    required_permissions = set(manifest.get("permissions", []))
    optional_permissions = set(manifest.get("optional_permissions", []))
    if (
        "tabs" in required_permissions
        or {"notifications", "nativeMessaging"}.intersection(required_permissions)
        or not {"notifications", "nativeMessaging"}.issubset(optional_permissions)
    ):
        raise SystemExit("Manifest permissions are broader than the reviewed release profile")
    missing = [path for path in sorted(manifest_paths(manifest)) if not (EXT / path).is_file()]
    if missing:
        raise SystemExit(f"Missing manifest assets: {missing}")

    for html_path in EXT.rglob("*.html"):
        parser = AssetParser()
        parser.feed(html_path.read_text("utf-8"))
        for asset in parser.assets:
            if re.match(r"^(?:https?:|//)", asset):
                raise SystemExit(f"Remote executable/style asset in {html_path}: {asset}")
            if not (html_path.parent / asset.split("?", 1)[0]).resolve().is_file():
                raise SystemExit(f"Missing HTML asset in {html_path}: {asset}")

    forbidden = []
    for js_path in EXT.rglob("*.js"):
        source = js_path.read_text("utf-8")
        if re.search(r"\beval\s*\(|\bnew\s+Function\s*\(", source):
            forbidden.append(str(js_path.relative_to(ROOT)))
        subprocess.run(["node", "--check", str(js_path)], check=True)
    if forbidden:
        raise SystemExit(f"Dynamic code execution found: {forbidden}")

    expected_id = extension_id(manifest["key"])
    native_template = json.loads(HOST_TEMPLATE.read_text("utf-8"))
    if native_template.get("name") != NATIVE_HOST_NAME:
        raise SystemExit("Native Messaging host name does not match the final release identity")
    allowed = set(native_template.get("allowed_origins", []))
    if f"chrome-extension://{expected_id}/" not in allowed:
        raise SystemExit("Native host allowed_origins does not match manifest key")

    leaked_names = []
    ignored_parts = {".git", "__pycache__", "artifacts", "dist"}
    for path in ROOT.rglob("*"):
        if not path.is_file() or ignored_parts.intersection(path.relative_to(ROOT).parts):
            continue
        if path.suffix.lower() not in PUBLIC_TEXT_SUFFIXES:
            continue
        try:
            text = path.read_text("utf-8")
        except UnicodeDecodeError:
            continue
        relative = path.relative_to(ROOT).as_posix()
        leaked_names.extend(public_name_leaks(relative, text))
    if leaked_names:
        raise SystemExit(f"Private comparison or retired brand names found in public tree: {leaked_names}")

    print(json.dumps({
        "manifest_version": manifest["manifest_version"],
        "version": manifest["version"],
        "extension_id": expected_id,
        "javascript_files": len(list(EXT.rglob("*.js"))),
        "html_files": len(list(EXT.rglob("*.html"))),
        "status": "valid",
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
