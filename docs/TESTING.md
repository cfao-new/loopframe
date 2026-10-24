# Test Record

Date: 2026-10-24

## Automated Local Tests

Command:

```powershell
npm test
```

Result: 23 tests passed.

Coverage:

1. All 30 combinations of the six scale modes and five overlays.
2. Animated GIF frame count and timing.
3. Zoom, drag driven horizontal and vertical movement, center reset, and
   background color.
4. PNG, JPEG, WebP, AVIF, and TIFF sources.
5. Animated GIF previews and exact catalog dimensions.
6. Six model catalog aliases, native panels, portrait canvases, and fallbacks.
7. G4 Doorbell Pro detected value priority and unverified community fallback.
8. Protect LCD discovery and animated file upload routing.
9. Artwork host restrictions.
10. Access and Protect protected credential storage.
11. Experimental setting persistence and complete deletion.
12. Removal of settings and rollback records.
13. Upload rollback after a failed settings update.

## Electron Interface Test

Command:

```powershell
npm run test:ui
```

Result: passed at 1424 pixels and 430 pixels.

Coverage:

1. Connection form and People page link.
2. Device discovery and selection.
3. Console supplied device artwork.
4. Local file selection and the animated live preview.
5. The G6 Pro Entry 480 by 854 screen shape and complete contained image.
6. Mouse drag positioning and removal of the old position sliders.
7. Every scale mode and overlay control.
8. Zoom, background color, and center reset.
9. Final animated review at 480 by 854.
10. Review dialog, publication result, rollback list, and restore action.
11. Experimental toggle default state and persistence.
12. Separate Protect sign in with protected storage.
13. Access and Protect device discovery with unsupported devices filtered out.
14. G4 Doorbell Pro 240 by 240 fallback and Protect upload routing.
15. G2 Reader Pro fallback artwork and portrait preview shape.
16. Unsupported screen devices remain preview only.
17. Artwork cache creation and deletion.
18. Connection removal and removal of every local setting.
19. Optional donation link visibility and address validation.
20. No horizontal overflow.
21. No page errors or console errors.

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
7. Exact 480 by 854 output for the G6 Pro Entry.
8. PNG, JPEG, WebP, AVIF, and TIFF processed outputs.
9. Each uploaded GIF became the active background and gallery item.
10. The original background and gallery were restored after every upload.
11. The temporary role and user were deleted.
12. The console user count and role count returned to their starting values.

Machine readable results:
[`evidence/07-live-end-to-end.json`](../evidence/07-live-end-to-end.json)
