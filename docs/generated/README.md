# Generated ops artifacts

These files are **machine-generated**. Do not hand-edit.

| File | Command | Purpose |
|------|---------|---------|
| `CAPABILITY-MATRIX.md` | `npm run matrix:generate` | Human-readable living API matrix |
| `capability-matrix.json` | same | Machine-readable matrix (CI / tooling) |
| `p0-deploy-verify-latest.md` | `npm run verify:p0` | Latest P0 checklist automation report |
| `p0-deploy-verify-latest.json` | same | JSON report |

**Overrides for pilot status:** `src/lib/capabilityMatrix/overrides.ts`  
**Stale check:** `npm run matrix:check`  
**Live P0:** `MERLIN_BASE_URL=… MERLIN_HEALTH_COOKIE=… npm run verify:p0:live`
