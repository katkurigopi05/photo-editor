---
tags: [moc, home]
---

# Project Director

An AI-native, non-destructive photo/video/audio editor with a shared
deterministic core for desktop and web. This vault is the knowledge base for the
codebase in this workspace.

> [!info] How to use this vault
> Open in [Obsidian](https://obsidian.md). Notes are atomic and cross-linked with
> `[[wikilinks]]`. Start here, or open the Graph view to see how everything
> connects. See [[How this vault works]].

## Product scope

> [!important] Personal use, on a local machine
> This is a **single-user desktop application that runs fully offline**. No
> account, no cloud sync, no sharing, no telemetry; AI runs on-device. That is a
> product decision with architectural teeth — see [[Rules/Local Only]].

[Adobe Lightroom](https://lightroom.adobe.com/) is the feature reference for the
photo side: we take its **editing and library model** (non-destructive
adjustments, masking, ratings/keywords/search) and drop its **service model**
(sync, sharing, subscription, hosted generative AI). The full mapping — adopted,
scaled down, and deliberately excluded — is in
[[Concepts/Lightroom Feature Reference]].

Current priority order from that gap analysis:

1. **Masking as a first-class object** — the single highest-leverage gap; makes
   every existing adjustment usable as a local adjustment
2. **HSL / Color Mixer**
3. **[[Concepts/Local Catalog|Local catalog]]** — ratings, flags, keywords, search
4. Color Grading (3-way), Dehaze, Texture
5. Optics and perspective correction

## Maps of content

- [[Rules/Non-negotiables|Non-negotiables]] — the rules every phase inherits
- [[Rules/Local Only|Local Only]] — offline, single-user, on-device scope
- [[Concepts/Command Engine|Command Engine]] — how mutations happen
- [[Concepts/Lightroom Feature Reference|Lightroom Feature Reference]] — what we take and what we drop
- [[Concepts/Local Catalog|Local Catalog]] — the library layer
- [[Data Model/Project|Data Model]] — what a project is made of
- [[Phases/Roadmap|Build Roadmap]] — phases and order

## Packages (TypeScript)

- [[Packages/canonical-json|@director/canonical-json]]
- [[Packages/project-schema|@director/project-schema]]
- [[Packages/command-schema|@director/command-schema]]
- [[Packages/editor-state|@director/editor-state]]
- [[Packages/playback-controller|@director/playback-controller]]
- [[Packages/ui-kit|@director/ui-kit]]
- [[Packages/export-engine|@director/export-engine]]

## Crates (Rust)

- [[Crates/media-core|media-core]]
- [[Crates/timeline-engine|timeline-engine]]
- [[Crates/project-store|project-store]]
- [[Crates/audio-engine|audio-engine]]
- [[Crates/export-engine|export-engine]]

## Phases

- [[Phases/Phase 0 Foundation|Phase 0 — Foundation]] ✅ built
- [[Phases/Phase 1 Media Decoding|Phase 1 — Media Decoding]] 🟡 image decode built
- [[Phases/Phase 2 Effects|Phase 2 — Effects]] 🟡 state layer built
- [[Phases/Phase 3 Playback|Phase 3 — Playback]] 🟡 transport core built
- [[Phases/Phase 4 Audio|Phase 4 — Audio]] 🟡 DSP core + state built
- [[Phases/Phase 5 Editing UI|Phase 5 — Editing UI]] 🟡 command boundary + session built
- [[Phases/Phase 6 Export|Phase 6 — Export]] 🟡 presets + plan + job built

## Decisions

- [[Decisions/ADR 0001 Decimal String Microseconds]]
- [[Decisions/ADR 0002 Deterministic Command Driven State]]

## Status

- TypeScript: format ✅ lint ✅ typecheck ✅ 177 tests ✅ build ✅
- Rust: fmt ✅ clippy ✅ 26 tests ✅
