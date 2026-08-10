# Screenshot capture list

The README references these four files by **absolute** `raw.githubusercontent.com` URL, because the
VS Code Marketplace does not resolve relative image paths — a relative `media/...` link renders on
GitHub but shows as a broken image on the extension page.

**The README's images 404 until these are captured and pushed to `master`.**

They are excluded from the `.vsix` on purpose (see `.vscodeignore`): the Marketplace fetches them
over HTTPS from GitHub, so shipping copies inside the package would only add weight.

| File | What must be visible |
|---|---|
| `inline-blame.png` | An editor with the end-of-line blame decoration on the current line, **and** the hover card open showing avatar, full message, both dates, and the diff stat. |
| `commit-graph.png` | The GitSense panel with the commit graph: the toolbar (branch picker, filter box, commit count), branch/tag labels in the left column, the dashed **Working Changes** row at the top, and commit details loaded in the pane beside it. This is the hero image — make it the best one. |
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

Save each at `media/screenshots/<name>.png`, commit, and push to `master`. The README picks them up
with no further changes.
