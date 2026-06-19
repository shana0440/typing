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

Import one complete, publicly reachable English HTML page for review:

```sh
bun run import:source https://example.com/article
```

The command writes a deterministic JSON draft under `.imports/drafts/`. It removes page chrome with Mozilla Readability, retains structured source prose for inspection, and does not add anything to the Catalog. PDF, authenticated, paywalled, non-English, unreachable, and incomplete sources are rejected.

Analyze and review a retained draft with the locally authenticated Codex CLI:

```sh
bun run publish:draft .imports/drafts/<draft-id>.json
```

The command loads the models available to the locally authenticated Codex CLI and presents a numbered selection before analysis; press Enter to accept the previous or Codex-default model, or pass `--model <model>` for automation. Codex analyzes one paragraph at a time as a read-only, ephemeral subprocess. Every validated paragraph is checkpointed in the retained draft, so a later run resumes unfinished work after interruption or token exhaustion. A determinate progress bar shows saved paragraphs.

After analysis, the command opens a local preview and requires separate confirmation that the draft is accurate and authorized for redistribution. Only both confirmations Publish deterministic static Catalog data; the command never commits, pushes, or deploys.
