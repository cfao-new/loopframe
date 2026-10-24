# Test Record

Date: 2026-10-24

## Automated Local Tests

Command:

```powershell
npm test
```

Result: 12 tests passed.

Coverage:

1. All 30 combinations of the six scale modes and five overlays.
2. Animated GIF frame count and timing.
3. Zoom, horizontal movement, vertical movement, center reset, and background
   color.
4. PNG, JPEG, WebP, AVIF, and TIFF sources.
5. Prepared preview generation.
6. Protected credential storage.
7. Removal of settings and rollback records.
8. Upload rollback after a failed settings update.

## Electron Interface Test

Command:

```powershell
npm run test:ui
```

Result: passed at 1424 pixels and 430 pixels.

Coverage:

1. Connection form and People page link.
2. Device discovery and selection.
3. Local file selection and animated preview.
4. Every scale mode and overlay control.
5. Zoom, horizontal and vertical movement, background color, and center reset.
6. Review dialog, publication result, rollback list, and restore action.
7. Connection removal and removal of every local setting.
8. No horizontal overflow.
9. No page errors or console errors.

## Live Console Test

Command:

```powershell
$env:LOOPFRAME_ENV_FILE = "C:\path\to\console.env"
npm run test:live
```

Result: 35 uploads passed and 35 exact restorations passed.

Coverage:

1. A custom Admin role with Access Full Admin and every other application set
   to None.
2. A local only account with the custom role.
3. Successful Access discovery.
4. HTTP 403 from Protect administration.
5. HTTP 403 from Network administration.
6. All 30 scale and overlay combinations.
7. PNG, JPEG, WebP, AVIF, and TIFF processed outputs.
8. Each uploaded GIF became the active background and gallery item.
9. The original background and gallery were restored after every upload.
10. The temporary role and user were deleted.
11. The console user count and role count returned to their starting values.

Machine readable results:
[`evidence/07-live-end-to-end.json`](../evidence/07-live-end-to-end.json)
