"""Download only pinned public assets. No credentials, remote code, or pickle weights."""
import concurrent.futures
import hashlib
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODEL_REV = "90c9989b1a342275dd0d1a95aad283c04e075671"
NOTINJECT_REV = "847ae76cf8fea5ed325429e569ae8cfef022d2e0"
DEEPSET_REV = "4f61ecb038e9c3fb77e21034b22511b523772cdd"


def fetch(item):
    relative, url = item
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        temporary = path.with_suffix(path.suffix + ".partial")
        for attempt in range(4):
            try:
                request = urllib.request.Request(url, headers={"User-Agent": "AgentGate-reproducible-experiment/1.0"})
                with urllib.request.urlopen(request, timeout=90) as response, temporary.open("wb") as stream:
                    while block := response.read(1024 * 1024):
                        stream.write(block)
                temporary.replace(path)
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(2 * (attempt + 1))
    digest = hashlib.file_digest(path.open("rb"), "sha256").hexdigest()
    print(f"Downloaded {relative}: {path.stat().st_size} bytes", flush=True)
    return {"path": relative, "url": url, "sha256": digest, "bytes": path.stat().st_size}


def main():
    model = f"https://huggingface.co/protectai/deberta-v3-base-prompt-injection-v2/resolve/{MODEL_REV}/"
    items = [("base-model/" + name, model + name) for name in
             ("config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
              "added_tokens.json", "spm.model", "model.safetensors", "README.md", "LICENSE")]
    for name in ("one", "two", "three"):
        file = f"data/NotInject_{name}-00000-of-00001.parquet"
        items.append(("sources/notinject-" + name + ".parquet",
                      f"https://huggingface.co/datasets/leolee99/NotInject/resolve/{NOTINJECT_REV}/{file}"))
    items.append(("sources/notinject-README.md", f"https://huggingface.co/datasets/leolee99/NotInject/resolve/{NOTINJECT_REV}/README.md"))
    for split, suffix in (("train", "9564e8b05b4757ab"), ("test", "701d16158af87368")):
        file = f"data/{split}-00000-of-00001-{suffix}.parquet"
        items.append((f"sources/deepset-{split}.parquet", f"https://huggingface.co/datasets/deepset/prompt-injections/resolve/{DEEPSET_REV}/{file}"))
    items.append(("sources/deepset-README.md", f"https://huggingface.co/datasets/deepset/prompt-injections/resolve/{DEEPSET_REV}/README.md"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        manifest = list(pool.map(fetch, items))
    (ROOT / "sources" / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
