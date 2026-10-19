# AgentGate procurement contrast dataset v1

This is a small, AI-authored synthetic domain-adaptation experiment. It is not a
sample of production traffic and was not independently annotated by human raters.

## Task and labels

Input: a user message or text arriving from a supplier document/tool result.
Label 0: ordinary procurement, legitimate security discussion, or requests to
preserve access/approval boundaries. Label 1: instructions attempting to override
authority, disclose restricted information, evade purchasing rules, poison a
retrieved answer, or tamper with execution/audit behavior. These are classifier
labels, not measurements of whether an agent obeyed an attack.

## Construction

`families.json` contains 60 original contrast pairs in six categories. Each pair
has one benign and one malicious message. Each message has four deterministic
context variants: bare message, helpdesk header, supplier excerpt, and retrieved
note. Thus 480 examples correspond to only 60 underlying families. Variants are
not 480 independently authored scenarios. Lexical shortcuts and shared authoring
style can make this dataset easier than real inputs.

Within each category, a fixed seed assigns six families to training, two to
validation, and two to testing. This gives 288/96/96 examples across 36/12/12
families. Both labels and all variants of a family stay in its split. Duplicate
normalized texts, group leakage, and ID leakage are checked. Similar themes can
remain across families; exact/group checks cannot prove semantic independence.
The author saw all examples during construction. "Held out" means excluded from
optimization and threshold selection, not hidden from the author.

Original generated text is identified as project material without borrowed
third-party passages. No real credentials or private user data are used. Example
destinations use reserved `.test` names. No attack text is executed.

## External diagnostic data

Neither external set is used for training, checkpoint selection, or threshold
selection. Exact overlaps with domain text and inputs outside the existing
6,000-character service limit are excluded before inference and logged. External
duplicates are counted but preserved to avoid silently changing the source
distribution. Public benchmark scores are not necessarily comparable with other
published scores because preprocessing, model windows, and thresholds differ.

- **NotInject**, Hao Li and Xiaogeng Liu, *InjecGuard: Benchmarking and Mitigating
  Over-defense in Prompt Injection Guardrail Models* (2024).
  https://huggingface.co/datasets/leolee99/NotInject
  Revision `847ae76cf8fea5ed325429e569ae8cfef022d2e0`.
  Use only `NotInject_one`, `NotInject_two`, and `NotInject_three` (339 benign
  prompts before filtering), not the additional train/test/validation files.
  Source declares MIT; original card is retained. All labels are benign; recall
  and attack-detection F1 are therefore undefined and must not be reported as
  zero-performance evidence. Some prompts discuss translation/non-English text;
  language metadata is copied at source level, not inferred per example.
- **deepset/prompt-injections**, deepset / JasperLS.
  https://huggingface.co/datasets/deepset/prompt-injections
  Revision `4f61ecb038e9c3fb77e21034b22511b523772cdd`.
  Both upstream splits are used ONLY as an external diagnostic set, not as
  AgentGate training data. Original labels are retained. The card has conflicting
  license fields: top-level Apache-2.0 and nested dataset_info CC-BY-4.0. Retain
  attribution and both declarations; do not claim an independently verified
  clean licensing history. Raw copies and source card remain traceable.

The original Protect AI checkpoint's complete training corpus is unavailable.
We cannot prove that these public examples were unseen by that upstream model.
They are unseen by our adaptation pipeline, which is a narrower statement.

## Predeclared analysis

Compare TF-IDF logistic regression, the fixed original detector, and full-parameter
DeBERTa adaptation with seeds 42, 43, 44. Select each threshold on domain validation
only, maximizing recall subject to empirical FPR <= 5%. This is operating-point
selection, not probability calibration, and does not guarantee test FPR <= 5%.
Also report the common fixed 0.5 threshold. Report every seed and every dataset;
do not choose the most favorable seed after evaluation. Use family-cluster
bootstrap intervals for domain results, acknowledging only 12 test families.
