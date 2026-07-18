---
tags: [concept]
---

# Command Envelope

Every public command carries the same envelope; all data that affects output is
inside it (the engine reads no ambient state).

```ts
interface CommandEnvelope {
  id: string;            // RFC 4122 UUID, lowercase hyphenated
  commandType: string;
  baseVersion: number;   // must equal project.currentVersion (0 for create)
  actor: { type: "user" | "agent" | "system"; id: string };
  createdAt: string;     // ISO-8601 instant, stored verbatim
  payload: unknown;
}
```

Validated as a [[Packages/command-schema|Zod]] discriminated union on
`commandType`. `createdAt` is stored verbatim to preserve [[Concepts/Canonical JSON|byte equality]].

Feeds the [[Concepts/Command Engine]] and becomes part of a [[Concepts/Project Operation]].
