## Problem Statement

The reader wants to practice English typing while reading complete books and articles, without the pressure of speed tests. Existing typing tools emphasize WPM, accuracy, timers, and short passages; conventional readers interrupt concentration when an unfamiliar word requires a separate lookup. The reader needs a continuous Typing Session that preserves the source, remembers Reading Progress locally, and provides contextual Traditional Chinese Word Help without leaving the keyboard.

The operator also needs to turn authorized English webpages into deployable Reading Sources. That workflow must preserve source content except for an approved, deterministic set of typing-friendly character replacements, use AI only for annotations, require explicit review, and keep AI credentials and runtime services out of the deployed site.

## Solution

Build a desktop-only, dark static reading and typing site. Its Catalog contains finite English Reading Sources that the reader types from beginning to end in an untimed Typing Session. A focused viewport shows a few lines around the current position, provides corrective feedback without scoring, saves Reading Progress after each completed word, and resumes on the same device.

`Alt+H` opens Word Help for the current word or phrase and `Escape` closes it. Help contains a contextual Traditional Chinese explanation, the highlighted source sentence, and a labeled AI-generated English example. Import-time analysis prepares help for CEFR B2+ terms, idioms, and contextually unusual meanings without marking vocabulary in the typing surface.

Provide a URL importer that extracts one complete HTML source, applies only the approved typing-friendly character replacements, delegates annotation analysis to an OAuth-authenticated Codex CLI, and opens a local preview. Explicit approval Publishes the Import Draft into static Catalog data. The operator commits generated files manually; GitHub Actions deploys the static SvelteKit site to GitHub Pages.

## User Stories

1. As the reader, I want to choose a Reading Source from a Catalog, so that I can practice with a book or article that interests me.
2. As the reader, I want the Catalog to feature my most recently active source, so that I can resume immediately.
3. As the reader, I want each source to show Reading Progress and completion state, so that I know what I have read.
4. As the reader, I want to restart a completed source explicitly, so that reopening it does not erase completion accidentally.
5. As the reader, I want a Typing Session to resume at my last completed word, so that I do not repeat substantial text.
6. As the reader, I want Reading Progress stored only on my device, so that I need no account.
7. As the reader, I want progress saved after every completed word, so that refresh or tab closure loses at most the current word.
8. As the reader, I want no timer, WPM, accuracy score, streak, or performance result, so that reading remains the goal.
9. As the reader, I want a session to continue until I stop or reach the Reading Source's end, so that arbitrary test lengths never interrupt it.
10. As the reader, I want three to five lines around my current position visible and advancing automatically, so that the screen stays focused without scrolling.
11. As the reader, I want completed text muted and upcoming text clear, so that my current position is obvious.
12. As the reader, I want a dark Typing Session with monospace text, so that character alignment is predictable.
13. As the reader, I want subtle chapter context and source completion percentage, so that I retain orientation without performance pressure.
14. As the reader, I want to type letters, capitalization, punctuation, and spaces exactly, so that I engage with the author's prose.
15. As the reader, I want paragraph boundaries to advance automatically, so that `Enter` is not part of typing the source.
16. As the reader, I want a Typing Error highlighted without blocking advancement, so that mistakes do not interrupt my reading flow.
17. As the reader, I want Typing Errors excluded from scores and summaries, so that mistakes remain feedback rather than penalties.
18. As the reader, I want Backspace to return to the previous visible character and clear its Typing Error, so that I can correct mistakes without restarting.
19. As the reader, I want `Alt+H` to request Word Help for the word containing the next character, so that I never need the mouse.
20. As the reader, I want `Escape` to close Word Help and restore typing focus, so that lookup does not break keyboard flow.
21. As the reader, I want typing paused while Word Help is open, so that panel interaction cannot alter Reading Progress.
22. As the reader, I want Traditional Chinese Word Help with the highlighted source sentence and a labeled generated English example, so that I understand the term in context.
23. As the reader, I want help to cover an entire idiom or phrasal verb and highlight its span, so that I learn the contextual meaning.
24. As the reader, I want no vocabulary markers in the typing surface, so that annotations do not distract me.
25. As the reader, I want a brief message when no help was prepared, so that the absence is understandable.
26. As the reader, I want a quiet completion view with title, completion date, Catalog action, and restart action, so that completion is useful without becoming a score screen.
27. As the operator, I want to import one complete publicly reachable HTML page through one command, so that Catalog maintenance fits my terminal workflow.
28. As the operator, I want unsupported crawling, PDFs, paywall bypass, and incomplete sources rejected, so that import behavior remains predictable.
29. As the operator, I want extraction to preserve source prose except for approved typing-friendly character replacements, so that AI cannot rewrite, correct, simplify, summarize, or paraphrase it.
30. As the operator, I want page chrome excluded while title, author, language, structure, URL, normalized text, and annotations remain reviewable, so that I can verify the complete Import Draft.
31. As the operator, I want AI to identify CEFR B2+ terms, idioms, and contextual meanings, so that Word Help is useful without annotating basic vocabulary.
32. As the operator, I want AI annotations structurally separate from immutable source content, so that supplemental output cannot be mistaken for the work.
33. As the operator, I want analysis delegated to my OAuth-authenticated Codex CLI, so that I do not manage a separate API key.
34. As the operator, I want a local browser preview and explicit terminal approval, so that AI output is never Published automatically.
35. As the operator, I want rejected drafts retained for inspection, so that extraction and annotation failures can be diagnosed.
36. As the operator, I want approved Catalog output to be deterministic static data, so that deployment needs no database or AI runtime.
37. As the operator, I want to confirm that a source is authorized for redistribution, so that the Catalog invariant is explicit.
38. As the operator, I want the importer to stop after writing files, so that it never commits, pushes, or deploys for me.
39. As the operator, I want Git diffs to expose every Catalog change, so that I can review publication before committing.
40. As the operator, I want GitHub Actions to build and deploy approved commits, so that publication is reproducible.
41. As the operator, I want no OpenAI credentials or calls in the deployed site, so that it remains safe to host as static files.

## Implementation Decisions

- Keep SvelteKit and the static adapter; produce a GitHub Pages-compatible static build.
- Split the system into a Node/Bun operator CLI that creates Catalog artifacts and a browser reader that consumes them.
- Model Catalog data with metadata, immutable source sections, stable identifiers, Word Help annotations, and exact source offsets for words and phrases.
- Keep normalized source content and annotations structurally separate. Validate that AI output cannot replace or mutate source text after deterministic typing-friendly character replacement.
- Accept one HTML URL per import. Use deterministic readability extraction for content and Codex only for metadata suggestions, vocabulary selection, Chinese explanations, and generated examples.
- Invoke a locally installed Codex CLI as a subprocess and require its OAuth login. Follow ADR-0001; never read or manipulate Codex OAuth tokens directly.
- Request structured AI output and validate it before creating an Import Draft. Invalid spans, missing fields, source mismatches, and malformed responses fail closed.
- Run a temporary local preview server. Publish remains an explicit terminal confirmation after visual review.
- Require operator confirmation that each source is authorized for redistribution; automated rights verification is not included.
- Generate Catalog files only after approval. Do not commit, push, or deploy from the importer.
- Represent Reading Progress as the last completed word boundary per stable source identifier and store it locally in the browser.
- Handle Catalog schema changes and corrupted local data without breaking the reader.
- Implement deterministic character progression over immutable source text. Every printable input advances the position, while a Typing Error remains highlighted for feedback. Backspace returns to the previous visible character, clears its error, and rolls Reading Progress back to a valid word boundary when necessary.
- Advance paragraph boundaries automatically; require exact input for all other visible letters, case, punctuation, and spaces.
- Suspend source input while Word Help is open. `Alt+H` targets the annotation containing the next character; `Escape` closes the panel and restores focus.
- Do not intercept `Ctrl+H`, which browsers reserve for History.
- Render a desktop-only dark interface with monospace source text, a focused viewport, muted completed text, subtle progress, and no performance statistics.
- Provide a Catalog with a prominent continuation card, source list, percentages, and completed states.
- On completion, record the date and show only the title plus Catalog and restart actions.
- Deploy through GitHub Actions to GitHub Pages, including the correct repository base path for routes and assets.

## Testing Decisions

- Test external behavior and persisted artifacts, not component internals, private functions, CSS classes, or exact AI wording.
- Use an importer workflow test as the highest CLI boundary. Serve fixture HTML locally, place a fake Codex executable on the process path, run the real command, and assert only approved source-character replacement, validated annotations, approval/rejection, and Catalog artifacts.
- Cover unreachable URLs, unsupported pages, extraction failure, Codex failure, malformed output, invalid annotation spans, and attempted source mutation.
- Use Playwright as the highest browser boundary, building on the existing setup. Cover Catalog selection, continuation, exact typing, Typing Error advancement and correction with Backspace, paragraph advancement, `Alt+H`/`Escape`, phrase help, unavailable help, per-word persistence, refresh recovery, completion, and restart.
- Verify the GitHub Pages production build and repository base path in automated checks.
- Add focused unit tests only where lower-level deterministic edge cases are clearer, including Unicode indexing, annotation spans, Catalog parsing, and corrupted progress recovery.
- Keep tests credential-free and deterministic with fixture servers and fake Codex output.

## Out of Scope

- Mobile and on-screen keyboard support.
- Accounts, authentication, cloud storage, and cross-device synchronization.
- Public uploads or in-browser source creation.
- Runtime AI, runtime dictionary APIs, and on-demand generation.
- WPM, timers, accuracy scores, streaks, leaderboards, achievements, and competitive modes.
- Non-English Reading Sources or typing rules.
- Any rewriting, correction, simplification, summarization, translation, or paraphrasing of source content.
- Multi-page crawling, chapter-link traversal, PDF, EPUB, paywall bypass, and authenticated fetching.
- Automated copyright or license verification.
- Automatic Git commits, pushes, or deployment from the importer.
- Hosting-level access control; deployed static files are treated as publicly retrievable.
- Visible vocabulary markers during a Typing Session.

## Further Notes

- The Catalog contains only Reading Sources the operator asserts are authorized for redistribution. Public availability alone is not authorization.
- GitHub Pages is the deployment target, but the application remains a conventional static build without Pages-specific runtime behavior.
- Codex CLI integration is local-only. Builds, tests, deployed assets, and browser sessions require no OpenAI authentication.
- The repository is a minimal SvelteKit starter with Vitest and Playwright examples, so implementation has no existing product compatibility constraints.
