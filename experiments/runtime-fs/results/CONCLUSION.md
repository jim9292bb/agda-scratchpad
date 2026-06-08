# Runtime / Filesystem Experiment Conclusion

This document summarizes the current benchmark evidence for the ALS `Cmd_load`
runtime/filesystem comparison in `experiments/runtime-fs`.

## What We Measured

Compared two benchmarkable runtimes:

- `runno-proxy-current`
- `browser-wasi-shim-memfs`
- `browser-wasi-shim-overlay-snapshot`

Measured fixtures:

- `builtin-nat`
- `stdlib-nat`
- `cubical-prelude`

All runs use the same ALS 2.8.0 WASM and the same stdlib/Cubical assets.

## Main Results

### `runno-proxy-current`

Representative `cubical-prelude` result:

| Metric | Value |
| --- | ---: |
| setupMs | 664.892ms |
| firstLoadMs | 13595.696ms |
| secondLoadMs | 4057.193ms |
| first pathStatCount | 2105 |
| second pathStatCount | 1301 |
| first agdaiRead | 18 |
| second agdaiRead | 11 |

This is still the closest benchmark to the main app's current architecture
because it keeps the cross-worker drive proxy in place.

### `browser-wasi-shim-memfs`

Representative results:

| Fixture | First load | Second load | First pathStatCount | Second pathStatCount |
| --- | ---: | ---: | ---: | ---: |
| builtin-nat | 611.774ms | 54.298ms | 1490 | 1202 |
| stdlib-nat | 11693.622ms | 222.132ms | 19130 | 8848 |
| cubical-prelude | 7292.786ms | 97.148ms | 4212 | 2604 |

Additional observations:

- `browser_wasi_shim` completed first and second `Cmd_load` for all three
  fixtures.
- It reached `ResponseEnd` reliably enough to produce stable JSON output.
- The second load is dramatically faster than the first load on every fixture,
  which indicates that the session-level `.agdai` reuse path is working in this
  harness.
- The path-stat profile is much lower than the current `runno-proxy-current`
  cubical baseline, which makes this runtime/filesystem combination a useful
  comparison point rather than just a correctness fallback.

### `browser-wasi-shim-overlay-snapshot`

Representative results:

| Fixture | First load | Second load | First pathStatCount | Second pathStatCount |
| --- | ---: | ---: | ---: | ---: |
| builtin-nat | 601.506ms | 53.051ms | 1490 | 1202 |
| stdlib-nat | 11618.205ms | 195.509ms | 19130 | 8848 |
| cubical-prelude | 7461.118ms | 97.545ms | 4212 | 2604 |

Additional observations:

- `browser_wasi_shim_overlay_snapshot` preserves the same stable benchmark
  shape as `browser_wasi_shim_memfs`.
- Compared with `browser_wasi_shim_memfs`, it is roughly on par on wall-clock
  time and keeps a lower `pathStat` duration profile in the cubical
  comparison.
- It should stay in the comparison set alongside `memfs`.

## Direct Comparison

`cubical-prelude` is the most useful comparison because it exercises the same
library-loading path that originally motivated this investigation.

| Runtime | First load | Second load | First pathStatCount | Second pathStatCount |
| --- | ---: | ---: | ---: | ---: |
| runno-proxy-current | 13595.696ms | 4057.193ms | 2105 | 1301 |
| browser-wasi-shim-memfs | 7292.786ms | 97.148ms | 4212 | 2604 |
| browser-wasi-shim-overlay-snapshot | 7461.118ms | 97.545ms | 4212 | 2604 |

Interpretation:

- `browser-wasi-shim-memfs` and `browser-wasi-shim-overlay-snapshot` are both
  much faster than `runno-proxy-current` on wall-clock time for
  `cubical-prelude`, especially on the second load.
- `browser-wasi-shim-overlay-snapshot` keeps a lower `pathStat` duration profile
  than `memfs` in this comparison table, even though total wall-clock time is
  roughly on par.
- `runno-proxy-current` is still the only runtime that matches the main app's
  existing architecture, so it remains the baseline for browser-side behavior.
- `browser_wasi_shim` is now a valid comparison family, not just a placeholder.

## Conclusions

1. `browser-wasi-shim-memfs` is benchmarkable in this project and should stay
   in the comparison set.
2. `browser-wasi-shim-overlay-snapshot` is also benchmarkable and stays in the
   comparison set alongside `memfs`.
3. `runno-proxy-current` remains the architectural baseline for the main app.
4. `runno-direct-fs` is still an architecture-level blocker and should not be
   used as the main comparison target.
5. For load-time investigation, the next useful direction is to compare why
   `browser_wasi_shim` gets a much shorter second load while `runno-proxy-current`
   still spends significant time in `pathStat` and drive-proxy work.

## Practical Next Step

If we continue this line of work, the next useful experiment is to align the
result format across `runno-proxy-current` and `browser-wasi-shim-memfs` with a
small, explicit comparison report for:

- `firstLoadMs`
- `secondLoadMs`
- `pathStatCount`
- `methodDurationsMs.pathStat`
- `.agdaiRead` / `.agdaiWrite`
