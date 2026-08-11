# Screenshots

Three of the four are **generated** — run `npm run shots`. `src/core/` has no `vscode` imports and the
view renderers are pure, so the real webview HTML can be produced in plain Node against this repo's
own history and photographed with headless Chrome. Re-run it after any UI change instead of
re-shooting by hand; see `scripts/shoot-screenshots.ts` for what is real and what is approximated.

| File | How |
|---|---|
| `commit-graph.png` | `npm run shots` |
| `commit-details.png` | `npm run shots` |
| `branch-comparison.png` | `npm run shots` |
| `inline-blame.png` | **manual** — an editor decoration is not a webview, so there is no HTML to render |

## Capturing inline-blame by hand

The README references these four files by **absolute** `raw.githubusercontent.com` URL, because the
VS Code Marketplace does not resolve relative image paths — a relative `media/...` link renders on
GitHub but shows as a broken image on the extension page.

**The README's images 404 until these are captured and pushed to `master`.**

They are excluded from the `.vsix` on purpose (see `.vscodeignore`): the Marketplace fetches them
over HTTPS from GitHub, so shipping copies inside the package would only add weight.

| File | What must be visible |
|---|---|
| `inline-blame.png` | An editor with the end-of-line blame decoration on the current line, **and** the hover card open showing avatar, full message, both dates, and the diff stat. |
| `commit-graph.png` | The Git Retrace panel with the commit graph: the toolbar (branch picker, filter box, commit count), branch/tag labels in the left column, the dashed **Working Changes** row at the top, and commit details loaded in the pane beside it. This is the hero image — make it the best one. |
| `commit-details.png` | Commit details with the action bar (Copy SHA / Copy message / Open on…) and **at least one file expanded** so the diff gutter's old/new line numbers are clearly legible. |
| `branch-comparison.png` | The comparison view showing both ref pickers, the swap button, and the Ahead / Behind / All Files tabs with their count badges. Pick two refs that actually differ so the counts aren't all zero. |

## Capturing

- Use a **dark theme** (Dark Modern) — the icon and banner are dark, so it reads as one set.
- Make the panel **taller than default** before shooting the graph; the default height crops the rows.
- Target roughly **1600–2000px wide**. Retina captures are fine and look sharper on the Marketplace.
- Crop to just the relevant UI. Don't include your whole desktop, other extensions' panels, or the
  status bar of an unrelated project.
- Use a repo with a few branches and merges — a single-lane linear graph undersells the feature.
- Check for anything you don't want public: file paths, branch names, real commit messages, tokens
  in a visible `.env`. One of the earlier dev screenshots had `.env` contents on screen.

## Where each one goes

Save straight into this folder under the exact filename above — don't leave them on the Desktop or
in `/var/folders`, where macOS deletes them and tooling can't read them:

```bash
mv ~/Desktop/Screenshot*.png media/screenshots/commit-graph.png
```

Each `<img>` tag already exists in `README.md`, wrapped in an HTML comment so the page doesn't
render four broken-image icons while the files are missing. To publish one, delete the two wrapper
lines around it:

```html
<!-- Screenshot pending. Delete this comment wrapper once ...      <- delete this line
<img src="https://raw.githubusercontent.com/..." alt="..." />
-->                                                               <- and this one
```

Then commit and push to `master`. The URLs are absolute `raw.githubusercontent.com` links, so they
only resolve after the push — not from a local file.
