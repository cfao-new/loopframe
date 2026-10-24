# Experimental Screen Devices

Experimental screen discovery is disabled by default. It appears in Settings
and uses the existing local settings store. Turning it off closes the active
Protect discovery session. Deleting all local data removes the preference, the
separate Protect credential, and the artwork cache.

The feature lists only screen devices that the connected console actually
reports. It does not turn the store catalog into a static device list.

## Device Matrix

| Device | Studio canvas | Native panel | Panel authority | Access route | Protect route | Animated status |
| --- | --- | --- | --- | --- | --- | --- |
| G4 Doorbell Pro | 240 by 240 fallback | 240 by 240 fallback | Community fallback, unverified | Not used | Image asset and LCD message, experimental | Unverified for this model |
| G6 Pro Entry | 480 by 854 | 480 by 854 | Official, verified | Background upload, verified | Not needed | Verified |
| Access G3 Intercom | 600 by 1024 | 1024 by 600 | Official, verified | Used when detected with `bg` and `bgs`, experimental | Not used | Experimental |
| Access Intercom, previous generation | 600 by 1024 | 1024 by 600 | Official, verified | Used when detected with `bg` and `bgs`, experimental | Not used | Experimental |
| Access Intercom Viewer | 720 by 1280 | 1280 by 720 | Official, verified | Used when detected with `bg` and `bgs`, experimental | Not used | Experimental |
| Access G2 Reader Pro | 286 by 1280 | 1280 by 286 | Official, verified | Used only when detected with `bg` and `bgs`, experimental | Not used | Experimental |

For the G4 Doorbell Pro, the connected Access or Protect record wins when it
provides screen dimensions. Otherwise the studio clearly labels the 240 by 240
community fallback as unverified.

## Discovery

When the feature is off, Loopframe keeps the stable Access background list.
When it is on, Loopframe asks Access for detected screen hardware and asks
Protect for cameras whose feature flags report a color LCD screen.

The G6 Pro Entry can appear in both applications. Loopframe merges the records
by device identity and keeps the verified Access background route.

Access screen hardware without `bg` and `bgs` remains visible for preview.
Publishing is disabled and the reason is shown on the device.

## Protect Route

The Protect path follows the published Protect 7.3 API:

1. Upload GIF, JPEG, or PNG data to `POST /v1/files/animations`.
2. Patch the selected camera with `lcdMessage.type` set to `IMAGE`.
3. Store the previous LCD message before the change.
4. Restore the previous LCD message from the rollback list.

Loopframe uses the equivalent authenticated console routes
`/proxy/protect/api/files/animations` and
`/proxy/protect/api/cameras/{id}`. The route is covered by automated tests.
Animated support remains unverified for the G4 Doorbell Pro because that
hardware was not attached to the test console.

The published Protect API does not provide a delete operation for uploaded
device assets. A successful Protect upload can therefore remain in the
Protect device asset library after the displayed welcome image is restored.

## Artwork

Artwork comes from the authenticated Access or Protect device record. The main
process accepts only the connected console origin or the approved
`static.ui.com` fingerprint asset path.

Artwork images are cached in the current user's application data folder.
Clearing the saved connection or deleting all local data removes that cache.
No copied Ubiquiti artwork is stored in the repository or application package.
