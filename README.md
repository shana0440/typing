# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
bun x sv@0.16.1 create --template minimal --types ts --add prettier eslint vitest="usages:unit,component" playwright tailwindcss="plugins:typography,forms" sveltekit-adapter="adapter:static" mcp="ide:other+setup:local" --install bun typing
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Creating an Import Draft

Attempt one credential-free public HTTP or HTTPS page:

```sh
bun run import:source https://example.com/article
```

The command fetches static HTML with browser-like public headers and writes an extracted or blocked JSON draft under `.imports/drafts/`. It preserves the raw response and diagnostics in an adjacent `.artifacts` directory, which is ignored by Git and retained until explicitly deleted. It does not render JavaScript, authenticate, crawl continuation links, or add anything to the Catalog.

For a successful extraction, compare the original page with the escaped structured candidates and approve one whole candidate:

```sh
bun run verify:source .imports/drafts/<draft-id>.json
```

Source Verification shows ranked Readability, semantic container, and cleaned-body candidates with their origins, warnings, URL provenance, and deterministic metadata suggestions. Title and author may be corrected; extracted prose cannot be edited. Analysis will not start until a candidate has been explicitly verified.

Analyze a verified draft and perform final review with the locally authenticated Codex CLI:

```sh
bun run publish:draft .imports/drafts/<draft-id>.json
```

The command shows the remaining workload, loads the models available to the locally authenticated Codex CLI, and presents a numbered selection before analysis. For large sources, an available Mini model is marked and preselected because frontier models may take hours; pass `--model <model>` to choose explicitly. By default, Codex analyzes one source block per read-only, ephemeral subprocess and runs one subprocess at a time. Use `--concurrency <1-16>` and `--batch-size <1-50>` to tune them independently. Requests are also limited to roughly 24,000 source characters, with an oversized block analyzed alone.

Every analysis subprocess runs in an isolated temporary directory with user configuration, repository rules, shell, multi-agent, app, hook, and web-search tools disabled. Its exact prompt, arguments, live JSONL events, live stderr, schema, and final response are retained under the draft's `.artifacts/codex/` directory for debugging. Every valid block result is validated and checkpointed immediately. If Codex omits part of a batch, only the missing blocks are retried; later runs resume finished work after a failure or interruption. Interactive terminals refresh the aggregate completed-block, active-request, retry, and elapsed-time line every second while Codex is working. Redirected output contains durable batch events and the final result only.

After analysis, the command opens a local preview and requires separate confirmation that the draft is accurate and authorized for redistribution. Only both confirmations Publish deterministic static Catalog data; the command never commits, pushes, or deploys.
