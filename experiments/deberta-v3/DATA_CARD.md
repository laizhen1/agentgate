# Expanded procurement injection data, v3

## Scope and annotation

The classifier scores supplier documents, search snippets, retrieved text and tool responses that may try to redirect a procurement assistant. Positive labels indicate attempted instruction/authority hijacking, unauthorized disclosure or execution, or corruption of the assistant's task/evidence. Negative labels include ordinary supplier information, legitimate procedure descriptions, quoted attack examples and security discussion. This is not a general harmful-content classifier.

All 240 new contrast pairs are original AI-authored text with AI-authored intent labels. There is no independent human annotation or adjudication. The author saw every example during dataset construction. The test is fresh relative to fitting and selection, not blinded to the author and not independently collected production traffic. Some labels require the assumed untrusted-source boundary, which a short fragment only approximates.

Each pair is one semantic family with a benign and an attack text. Eight categories have 30 families each: authority, exfiltration, procurement, tool boundaries, retrieval, audit/workflow, obfuscation/language and memory/task hijacking. Examples include mixed-language and Chinese text, but the corpus is predominantly English and is not a multilingual benchmark. It does not measure long-context attacks, adaptive attackers or live agent outcomes.

## Counts and split

| Split | Texts | Benign / attack | Families |
|---|---:|---:|---:|
| Training | 360 | 180 / 180 | 180 |
| Validation | 96 | 48 / 48 | 48 |
| Fresh test | 96 | 48 / 48 | 48 |

New families are ordered by SHA-256 of a fixed salt plus family ID within each category, assigning 18/6/6 to training/validation/test. The new contribution is 288/96/96 texts from 144/48/48 families. Training also retains 72 original unwrapped texts from the 36 v1 training families. The 216 repeated wrappers are removed. Old validation/test data are not moved into training or selection. Compared with v1, training grows from 36 to 180 authored families and test grows from 12 to 48; raw row counts alone obscure that difference.

There is no template-wrapper expansion in v3. Pairs remain correlated and the authoring style and attack concepts are shared across splits; 96 test texts must not be called 96 independent scenarios. Source-family grouping does not certify complete semantic independence.

## Leakage and provenance checks

`prepare_data.py` rejects cross-split normalized exact matches and character-5-gram Jaccard similarity of at least 0.65. It checks train/validation/test against one another and against old validation/test plus the two public diagnostics. `data/overlap-audit.json` records the closest pair in each comparison. This is a lexical check, not a guarantee of semantic novelty or absence from upstream pretraining. No examples were removed or relabelled using model scores.

`families.json`, the authoring/build code, all data files, and the overlap audit have recorded hashes. Rebuilding uses only local files, without model calls or network access. Changes after results require a new experiment version.

## External diagnostics and privacy

The byte-identical v1 deepset file has 662 labelled examples; NotInject has 339 benign-only examples and supports false-positive-rate measurement, not attack recall/F1. Their source revisions, licenses and original hashes remain in `../deberta-v1/sources/manifest.json` and the v1 data card. Neither set is used to fit, choose hyperparameters or select thresholds. Their earlier results were already known; upstream training overlap is unknown. Do not combine them into a single 1,001-example F1 test.

New examples contain no real buyer/supplier records. Addresses use the reserved `example.invalid` domain. Injection payloads are inert strings and are never executed. Original generated material follows the project's license; copied diagnostic material retains its documented third-party licenses.
