"""Check public artifacts without printing any matched sensitive content."""

import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import zipfile


ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    "private key": rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
    "GitHub token": rb"gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}",
    "AWS access key": rb"AKIA[0-9A-Z]{16}",
    "API key": rb"sk-(?:proj-)?[A-Za-z0-9_-]{40,}",
    "personal home path": rb"(?:[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s\"<>]+|/(?:Users|home)/[^/\s\"<>]+)",
    "account-linked hosting ID": rb"appgprj_[a-z0-9]{20,}",
}


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def inspect_content(label, content, errors):
    if zipfile.is_zipfile(io.BytesIO(content)):
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if archive.testzip():
                errors.append(f"{label}: invalid ZIP checksum")
            for member in archive.infolist():
                if not member.is_dir():
                    inspect_content(f"{label}!{member.filename}", archive.read(member), errors)
        return
    for kind, pattern in PATTERNS.items():
        if re.search(pattern, content):
            errors.append(f"{label}: possible {kind}")


def main():
    errors = []
    files = [p for p in git("ls-files", "-z").decode("utf-8").split("\0") if p]
    for name in files:
        inspect_content(name, (ROOT / name).read_bytes(), errors)
    # CI checkout may be shallow; the release audit separately checks all history.
    emails = git("log", "--format=%ae%n%ce", "HEAD").decode("utf-8").splitlines()
    if any(not email.endswith("@users.noreply.github.com") for email in emails):
        errors.append("Git history: use GitHub no-reply author/committer email addresses")

    experiment = ROOT / "experiments/deberta-v1"
    manifest = json.loads((experiment / "results/manifest.json").read_text(encoding="utf-8"))
    expected = dict(manifest["code_sha256"])
    expected["protocol.json"] = manifest["data"]["protocol_sha256"]
    expected["families.json"] = manifest["data"]["families_sha256"]
    for name, entry in manifest["data"]["datasets"].items():
        expected[f"data/{name}.jsonl"] = entry["sha256"]
    for name, digest in expected.items():
        if hashlib.sha256((experiment / name).read_bytes()).hexdigest() != digest:
            errors.append(f"{name}: frozen experiment hash mismatch")
    bundle_root = experiment / "bundles"
    bundles = json.loads((bundle_root / "SHA256SUMS.json").read_text(encoding="utf-8"))
    for name, digest in bundles.items():
        if hashlib.sha256((bundle_root / name).read_bytes()).hexdigest() != digest:
            errors.append(f"{name}: bundle hash mismatch")

    if errors:
        raise SystemExit("\n".join(errors))
    print(f"Public artifact checks passed: {len(files)} tracked files, ZIP contents, "
          f"no-reply commit emails, {len(expected)} frozen hashes, and {len(bundles)} bundles.")
    print("Pattern checks supplement manual review; they do not prove absence of all personal data.")


if __name__ == "__main__":
    main()
