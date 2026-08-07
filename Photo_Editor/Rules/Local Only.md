---
tags: [rule, scope]
---

# Local Only

This editor is for **one person, on their own machine**. That is a product
decision, and it constrains architecture — it is not a "later we'll add sync"
placeholder.

Rules inherited by every phase. Breaking any of these is a defect.

1. **The app runs fully offline.** Launching, importing, editing, and exporting
   must all work with no network. A missing network is never an error path.
2. **No account, login, or subscription.** There is no user identity to model,
   so nothing is scoped by user ID.
3. **No cloud storage or sync.** The catalog and the originals live on local
   disk, at paths the user chose. See [[Concepts/Local Catalog]].
4. **No telemetry, analytics, or crash upload.** Nothing about the user's photos
   or usage leaves the machine.
5. **AI runs locally.** Models are downloaded once, checksummed, and cached on
   disk; inference is local. No image is uploaded to an inference service. This
   is why [[Packages/bg-segmentation]] uses a bundled U²-Net rather than a
   hosted API.
6. **No multi-user concerns.** No sharing, permissions, collaboration, comments,
   or web galleries. Export writes a file to disk; distribution is the user's
   business, not the app's.
7. **Network access is opt-in and non-essential.** The only permitted outbound
   call is a first-run model download, which must be explicit, checksummed, and
   skippable by pointing at a local file.

## Why this is written down

Lightroom is the feature reference for this project (see
[[Concepts/Lightroom Feature Reference]]), but Lightroom is a *cloud* product —
a large share of its surface exists to serve sync, sharing, and a subscription.
Copying its feature list uncritically would drag in an account system, a sync
engine, and a hosted-AI dependency this project does not want. The rules above
are the filter applied to that reference.

Related: [[Rules/Non-negotiables]].
