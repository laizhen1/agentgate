"""Export small reproducibility artifacts, excluding weights and local trainer paths."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    if not json.loads((args.run / 'verification.json').read_text())['verified']:
        raise ValueError('Only verified results may be packaged')
    args.destination.mkdir(parents=True, exist_ok=False)
    allowed_top = {'manifest.json', 'environment.lock.txt', 'events.log', 'hyperparameter-selection.json',
                   'selection-lock.json', 'evaluation-start.json', 'evaluation-complete.json', 'comparison.json',
                   'comparison.csv', 'aggregate.json', 'REPORT.md', 'verification.json'}
    for source in sorted(args.run.iterdir()):
        if source.is_file() and source.name in allowed_top:
            shutil.copyfile(source, args.destination / source.name)
        elif source.is_dir() and (source / 'selection.json').exists():
            target = args.destination / source.name
            target.mkdir()
            for file in sorted(source.iterdir()):
                if file.is_file() and file.suffix == '.json' and file.name not in ('vocabulary.json', 'weights.json'):
                    shutil.copyfile(file, target / file.name)
    hashes = {p.relative_to(args.destination).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted(args.destination.rglob('*')) if p.is_file()}
    (args.destination / 'SHA256SUMS.json').write_text(json.dumps(hashes, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'files': len(hashes), 'bytes': sum(p.stat().st_size for p in args.destination.rglob('*') if p.is_file())}))


if __name__ == '__main__':
    main()
