# DEAD / DROP

This repository contains the public DEAD / DROP game and its GitHub Pages workflow.
The authorized destination is https://technoetic.github.io/dead-drop/.
Never publish this project to Sites or chatgpt.site.

Use native JavaScript modules, CSS, SVG and Node.js 22 or later, with no runtime
dependencies. Keep game, screens, services and shared utilities separate, and keep
styles in tokens/base/components/home/effects/game. Test semantics and session state before
publishing. Finite sample comparisons do not establish general program equivalence
or performance improvements.

Run `npm test`, `npm run build` and `node scripts/manifest.mjs`. GitHub Pages must
serve the versioned assets and manifest from the same deployment. Preserve the
loaded HTML build identity, safe next-navigation update handling, and unsaved game
protection. Keep only one previous live asset generation, verified by its manifest
hashes, before creating the new static output. A missing previous manifest is
permitted only for the first repository push; later retention failures stop CI.

Keep private notes, credentials, source archives and QA evidence outside this
repository. Commit only task files. Browser automation uses Aside CLI; do not add
Playwright. Deployment changes require explicit user authorization.
