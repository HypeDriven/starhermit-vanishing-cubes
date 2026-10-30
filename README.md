# Vanishing Cubes

A three-dimensional direction puzzle. Rotate a floating cube assembly in a pale
sky and release blocks whose arrow path is clear. Expose the core.

A StarHermit engine script game (engine 1.29.0, `engine.minor=31`): see
`spec.md` §0 for how it is built.

- `npm test` — unit tests and the native engine checks (needs the runtime at
  `~/sh/runtime/1.24.0/…` or `STARHERMIT`).
- `npm run package` — rewrite the web loader and file index after any change.
- `npm run css` / `npm run levels` — regenerate the UI styles / the
  precomputed Journey and challenge boards.
- `npm run test:browser` — play the web package in GPU Chrome.

Modes: Learn, Journey (40 stages in five chapters), Daily, Practice,
Challenge and Score chase.
