# rig

Keeps a lane's lights on while nobody is in it: a heartbeat every minute, a status board, and
(next) a morning digest of what ran overnight.

```sh
cp .env.example .env   # set LANE_MARKER
pnpm install
pnpm dev               # http://localhost:8787
```

Working on it with an agent: start at [AGENTS.md](AGENTS.md).

## Review preview

The preview is one HTML file from `GET /digest/2026-10-28`. The render command calls
`app.request()`. It needs no running server or browser. The page includes its stylesheet.

Use Node 24 and pnpm 11.25.0. Install with `pnpm install --frozen-lockfile`.
Render to a directory outside this repository:

```sh
pnpm preview:render --output "${TMPDIR:-/tmp}/rig-pages/index.html"
```

The command reads `.env` when it exists. Use `--night YYYY-MM-DD` to select another night.
It fails if the digest response is not HTTP 200. It rejects output paths inside this
repository, including symlinks into the repository. It does not print HTML or the marker.
Do not commit `.env` or preview files. Do not attach previews to issues or chats.

For a clean local copy, bypass `.env` loading and remove the marker from the environment:

```sh
env -u LANE_MARKER node --import tsx scripts/render-preview.ts --output "${TMPDIR:-/tmp}/rig-pages/index.html"
```

The banner must then read `no marker set`.

### Publish after human approval

The `Publish review preview` workflow runs only through `workflow_dispatch`.
A push does not publish the page. Its artifact is `$RUNNER_TEMP/rig-pages/index.html`,
outside the checkout. The artifact expires after one day; the published page remains until replaced.

1. Merge the reviewed code and lockfile into the default branch.
2. Obtain separate human approval for the first public Pages publication, including its lane marker.
3. Configure Pages to use **GitHub Actions** in the repository settings.
4. Add `S01E04_LANE_MARKER` as an Actions secret through the secret settings. Never paste its value into an issue or chat.
5. Run `Publish review preview` on the reviewed default branch with `include_marker` set to `true`.
6. Confirm that [the public preview](https://szymonkm.github.io/mega-s01e04-rig/) opens over HTTPS and shows the expected digest and banner.
7. Send the reviewer the public link and the plan's issue links. Keep issue #6 open until this is done.

The workflow fails when `include_marker` is `true` and the secret is missing or blank.
It runs tests and type checks before rendering. Pages deployment uses the `github-pages`
environment. Configure its protection rules if the repository supports required reviewers.

### Replace after review

Replacement needs a separate human approval after review. Approval for the first publication
does not approve replacement.

1. Prepare a clean copy and confirm that its banner reads `no marker set`.
2. Obtain human approval to replace the public page at the same URL.
3. Run the same workflow with `include_marker` set to `false` (the default).
4. Check the public URL again. Confirm that the marker is absent and the banner reads `no marker set`.
5. Complete the cleanup issue and archive the plan only after the public check succeeds.

The clean workflow unsets `LANE_MARKER`. A fresh checkout has no `.env` file.
The workflow never runs the render command with shell tracing and never prints the HTML.

Workflow references: [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages),
[Pages artifact inputs](https://github.com/actions/upload-pages-artifact), and
[Pages deployment inputs](https://github.com/actions/deploy-pages).
