# Model attribution

**`u2netp.onnx`** — U²-Net-p (the compact variant of U²-Net), by Xuebin Qin,
Zichen Zhang, Chenyang Huang, Masood Dehghan, Osmar R. Zaiane, Martin
Jagersand. Licensed under the Apache License, Version 2.0.

Downloaded from `rembg`'s (MIT-licensed, github.com/danielgatis/rembg) own
GitHub release assets:
`https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx`

MD5 checksum verified against the value `rembg` publishes in its own source
(`rembg/sessions/u2netp.py`): `8e83ca70e441ab06c318d82300c84806`.

The larger, higher-accuracy `u2net.onnx` (167.8 MB) is not bundled here (it
exceeds GitHub's 100 MB push limit); it is fetched on demand at the same
release URL and SHA-256-verified client-side before use — see
`packages/bg-segmentation/src/inference.ts` and
`docs/phases/ai-background-removal.md`.
