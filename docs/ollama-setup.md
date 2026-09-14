# Local Ollama setup (IntelliJ / Windows)

The live agent uses your own Ollama server. No API key or paid model service is
required. It is never silently replaced by a simulated model.

1. Install Ollama from https://ollama.com/download/windows and start the app.
2. In IntelliJ's terminal, download a tool-capable model, for example:

   ```powershell
   ollama pull qwen3:4b
   ```

   This downloads several GB. Pick another tool-capable model if your machine has
   different memory constraints. Model latency and tool reliability vary.

3. In the project root, create an **untracked** .env.local file:

   ```dotenv
   AGENTGATE_OLLAMA_MODEL=qwen3:4b
   AGENTGATE_OLLAMA_URL=http://127.0.0.1:11434
   ```

4. Install dependencies with npm run install:ci if needed. Run npm run build
   once to generate the local Worker configuration. Apply migrations to a fresh
   local database in filename order, or apply only 0001 if the reference lab is
   already initialized:

   ```powershell
   node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_melted_red_ghost.sql
   node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_next_shape.sql
   ```

   Do not reapply an existing migration. Do not delete your database to fix a
   migration error.

5. Restart with npm run dev. Open http://localhost:5173/platform, sign in using
   the local development sign-in, and create an organization.
6. Run “Search the catalog for a laptop and report its price.” Inspect the real
   model conversation, tool result, token counts, and trace.
7. Test approvals with “Send a stock inquiry to https://supplier.example.com.”
   Approve the exact action in **Approvals**, then resume the run.
8. Run a development benchmark before the holdout set. Exports include frozen
   case definitions, suite hash, mode, model identifier, policy, and raw evidence.

The published private website has no Ollama configuration and cannot contact a
laptop loopback address. Run live evaluations locally; exported JSON is portable.
Local and hosted databases are separate; exports are not automatically uploaded.
For local built-Worker execution (npm start), use Wrangler's local variables
configuration rather than expecting Vite's .env.local loading to run.

Troubleshooting:

- Model missing: run ollama list and match its name exactly in .env.local.
- Unreachable: confirm Ollama is running; do not expose port 11434 publicly.
- Model timeout: try a smaller tool-capable model. Requests time out at 90 seconds.
- No tools called: choose a tool-capable model; this is a real failure mode and
  is reflected in usefulness scores, not hidden.
- Approval expired / policy changed: reject the pending action, then rerun.
- Interrupted browser: reopen the organization and resume. An in-flight model
  lease expires after two minutes; already committed tool effects do not repeat.

Protocol references: https://docs.ollama.com/api/chat and
https://docs.ollama.com/capabilities/tool-calling.
