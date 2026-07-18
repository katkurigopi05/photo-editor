# Canonical JSON

`@director/canonical-json` implements the single serializer used wherever
byte-equivalence is asserted (replay verification, determinism tests,
persistence).

## Rules

- Object keys are sorted lexicographically by **UTF-16 code unit**, recursively.
  (JavaScript's default string comparison is exactly this ordering.)
- Arrays preserve element order.
- No insignificant whitespace.
- Only JSON-native values may be serialized: string, number, boolean, null,
  array, object.
- `bigint`, non-finite numbers, and `undefined` array elements **throw** — bugs
  surface loudly rather than producing silently divergent output.
- `undefined`-valued object properties are skipped, mirroring `JSON.stringify`.
  Absent optional fields must be omitted by construction (never set to
  `undefined`).

## API

```ts
canonicalStringify(value: unknown): string;
canonicalEqual(a: unknown, b: unknown): boolean;
deepClone<T>(value: T): T; // canonical round-trip; no shared references
deepFreeze<T>(value: T): T; // test helper
```

## Timestamps

`createdAt` / `updatedAt` are stored and re-emitted **verbatim** as the strings
supplied in commands. Validation may parse them to confirm they are ISO-8601
instants, but the stored value is the original string — normalization would
break byte equality.
