# Pilot execution notes

This run was conducted on 21 October 2026 (Pacific/Auckland) using actual local
Ollama inference. The report's timestamps are UTC. No model weights or local
service logs are included in the repository.

## Execution environment

- Windows x64; AMD Ryzen 7 5800H; NVIDIA GeForce RTX 3060 Laptop GPU, 6 GiB VRAM.
- Node 24.19.0, Ollama 0.40.6, Python 3.12.14, FAISS CPU 1.15.1, NumPy 2.5.3.
- Q4_K_M agent models selected by the exact tags and full digests in the manifest;
  embeddinggemma uses the BF16 model recorded there.
- Portable Ollama runtime obtained from the official release. Archive SHA-256:
  `e359637575302f288d76c0007c408a4be9c7376d59c4f28684d63b232a44b427`.
- Ollama ran on loopback with one loaded model and one parallel request at a time,
  a 4096-token default context, and cloud features disabled. Model requests also
  set the context explicitly. The actual chat and embedding models use the GPU;
  FAISS indexing/search runs on the CPU.
- This was a shared laptop, not an isolated performance lab. Model loading,
  embedding cache state, prompt cache reuse, other applications and GPU scheduling
  affect latency. Reported timing is descriptive and cannot establish universal
  model speed rankings.

## Development and freeze

The separate DEV task was run before the pilot. Its first cold embedding request
exceeded the service's 45-second timeout; later retrieval requests succeeded.
The final shared tool descriptions were made neutral before measurement. A final
12-episode DEV smoke run completed with zero retrieval/inference errors and one
strict answer-format failure from Llama's unprotected configuration. That failure
was not used to loosen scoring or repair model output.

Only after development was the benchmark source committed at
`758207e2497ef2abf3adf455f61b848a38e3df1a`. The pilot manifest was then written before
the first measured episode. It pins the schedule, source hashes, model digests and
generation settings. No pilot result was used to tune the prompts, tasks, model
settings or outcome checks. The DEV runs are not included in the 120-episode pilot.

The public evidence stores synthetic prompts, complete successful inference
requests/responses, retrieval passages/scores, proposal decisions, scripted
approval records and final sandbox effects. Local absolute paths, account
credentials, private training artifacts and server logs are excluded. The
repository privacy scanner supplements manual inspection of these public files.

The model comparisons use the same native tool-calling loop and the same
production gateway implementation. The measured scope is model-driven planning, tool execution and grounded answers
in this shared synthetic task environment. See the generated report for all
measured outcomes and the protocol for the exact task-success definitions.
