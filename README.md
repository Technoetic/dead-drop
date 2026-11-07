# DEAD / DROP

A Korean refactoring arcade about Martin Fowler's [Remove Dead Code](https://refactoring.com/catalog/removeDeadCode.html).

Play: https://technoetic.github.io/dead-drop/

Remove unused blocks, preserve outputs and observable actions, and build a combo through eight stages. A 90-second challenge and untimed practice support pointer, touch and keyboard. No account or external runtime service.

## Run

Node.js 22 or later (CI uses 24). No runtime dependencies.

```sh
npm test
npm run build
npm start
```

Local URL: http://127.0.0.1:8807/dead-drop/

## Controls

Click or tap remove/restore. Arrow up/down selects a block, Enter/Delete toggles it, Space verifies and Escape pauses. Hints and failed checks cost five seconds in challenge mode; practice has neither deadline nor time penalty. Save progress explicitly to resume later. Records stay in this browser only.

## The model

Cards describe a finite dependency graph, interpreted with bounded operations. Displayed JavaScript is illustrative text, never evaluated. Every declared scenario is checked, along with ordered notifications and storage effects. Event callbacks and externally used roots remain protected. A trace from one input is only a clue. Winning requires removal of every block proved unused within this model.

This is not a tool for deleting real source. Finite scenarios and declared relationships are not proof for arbitrary programs, reflection, network callers or production runtimes. Removing text does not by itself imply faster execution.

## Structure and updates

Native modules separate game, screens, services and shared helpers. CSS separates tokens, base, components, home, effects and game. Data loads with cancellation, timeout, validation and retry. Build identity hashes HTML, modules, styles, levels and vector art. Navigation checks the published identity; unsaved/saving progress is protected before a full-document update. Failed checks preserve the usable page.

Build-specific assets retain one verified previous published generation. Pages workflow validates the manifest and SHA-256 hashes before retaining it. GitHub controls HTTP caching on Pages; the app does not claim to configure those headers. No service worker.

## Publication

GitHub Actions tests, builds and deploys dist to GitHub Pages from main. Never publish this project to Sites/chatgpt.site. Private QA files and screenshots stay outside the repository.

Original game, questions, examples and vector art; no affiliation with Martin Fowler.
