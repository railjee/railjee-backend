# Small fixes: empty materials list and the unused department list

- **Date:** 2026-10-29
- **Status:** Implemented. Not type-checked: dependencies are not installed in this checkout.
- **Repo:** railji-backend (`apps/railji-business`)

## Problems

1. **`GET /departments/:departmentId/materials` returns 404 when a department has no materials** (`modules/departments/departments.service.ts:107`). "Nothing yet" isn't an error. The frontend works around it by special-casing the 404 (`RailJee/src/components/DepartmentDetailClient.tsx:397`).
2. **`APP_CONSTANTS.DEPARTMENTS` in `src/constants/app.constants.ts` is out of date** (it has `others` and is missing legal, medical, security and stores) **and nothing uses it.** Departments come from the database.

## Changes

| File | Change |
|---|---|
| `modules/departments/departments.service.ts` | Remove the `NotFoundException` for an empty result and return `[]` (cached like any other result). Also remove the import if nothing else uses it. |
| `src/constants/app.constants.ts` | Delete the unused `DEPARTMENTS` list and its re-export, so it can't drift again. |

The frontend needs no change: it already treats `data: []` as "no materials", and the 404 branch simply stops being used.

## Out of scope

- Auth on the materials route (logged-out access is parked).
- The paid-paper access gaps on `/answers` and single questions (parked for later).

## Testing

- Run `npx tsc --noEmit -p apps/railji-business/tsconfig.app.json` (or the project build) and lint.
- Check that `grep -rn "DEPARTMENTS" apps libs` finds no remaining users.
