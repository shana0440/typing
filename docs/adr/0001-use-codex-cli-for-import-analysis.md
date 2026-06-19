# Use Codex CLI for import analysis

The source importer delegates AI analysis to a locally installed, OAuth-authenticated Codex CLI instead of calling the OpenAI API with an API key. This keeps credentials and AI calls out of the deployed static site and lets the sole operator use an existing ChatGPT subscription, at the cost of requiring Codex CLI for imports and coupling that workflow to its command-line contract.
