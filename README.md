# Loopframe

Loopframe is a desktop studio for preparing animated backgrounds for UniFi
Access doorbells and intercom displays. It keeps the source file on your
computer, renders the final GIF at the display size, and uploads it with the
account you choose.

![Loopframe studio](docs/screenshots/studio.png)

## What It Does

1. Signs in to one UniFi OS console with a local account.
2. Finds Access devices that expose background controls.
3. Opens GIF, PNG, JPEG, WebP, AVIF, and TIFF files from their current folder.
4. Frames the image with six scale modes, zoom, horizontal and vertical
   position, background color, and five optional overlays.
5. Renders an animated GIF at 225 by 400 pixels.
6. Shows the exact prepared output before publication.
7. Saves the current device background before changing it.
8. Restores the previous background and removes the Loopframe upload on
   request.

![Connection setup](docs/screenshots/setup.png)

## Account Requirements

Create a dedicated local admin account with only the Access application
permission.

1. Open `https://<console>/network/default/admins`.
2. Open **Roles**, then **Create New Role**.
3. Choose **Admin** and name the role `Loopframe`.
4. Set **Access** to **Full Admin**.
5. Set Network, Protect, InnerSpace, Control Plane, and every other
   application permission to **None**.
6. Open **People**, then **Add New Person**.
7. Choose **Admin** and assign the `Loopframe` role.
8. Turn on **Local Account Only**.
9. Enter a local username and password.
10. Leave **Door Access** off unless that person also needs to open doors.

Do not grant **All Applications** or **Super Admin**. Access Full Admin is
needed because UniFi does not expose a background only permission. View Only
and Door Attendant cannot change a device background.

The setup screen contains the same guidance inside the application.

## Run From Source

Requirements:

1. Node.js 22 or newer.
2. A UniFi OS console with the Access application.
3. A compatible Access intercom or display.

Install and start:

```powershell
npm install
npm start
```

The application stores non secret preferences in the current user's
application data folder. Password storage is optional. When enabled, the
password is encrypted with Electron `safeStorage`, which uses the current
user's operating system credential protection.

## Image Controls

| Control | Result |
| --- | --- |
| Fill screen | Covers the display and crops overflow |
| Show all | Keeps the full source visible and fills unused space with the selected color |
| Fit width | Matches the source width to the display |
| Fit height | Matches the source height to the display |
| Original size | Keeps source pixels at their original size |
| Stretch | Forces the source to the display shape |
| Zoom | Scales the framed result from 25 to 250 percent |
| Horizontal | Moves the image from left to right |
| Vertical | Moves the image from top to bottom |
| Background | Fills visible space around the source |

Available overlays are **No overlay**, **Bottom fade**, **Top fade**,
**Soft vignette**, and **Focus frame**.

![Settings and rollback](docs/screenshots/settings.png)

## Tests

Run the local engine and rollback tests:

```powershell
npm test
```

Run the Electron interface test:

```powershell
npm run test:ui
```

Run the live console test:

```powershell
$env:LOOPFRAME_ENV_FILE = "C:\path\to\console.env"
npm run test:live
```

The live test creates a temporary Access only administrator, confirms that
Protect and Network administration are denied, tests every scale mode and
overlay against the real device, checks each prepared upload, restores the
starting background after every case, then removes the temporary account and
role.

The completed live record is in
[`evidence/07-live-end-to-end.json`](evidence/07-live-end-to-end.json).

## Package

Build a portable Windows executable:

```powershell
npm run pack:win
```

The output is written to `dist`. The same source can be built on macOS and
Linux with `electron-builder`.

The application does not require an installer, a system service, or operating
system administrator rights. Each user gets a separate settings folder.

## Local Data

Open **Settings** to:

1. Test the saved console connection.
2. Restore a background saved by Loopframe.
3. Remove the saved console and sign in.
4. Delete every Loopframe preference and rollback record.

Removing local data does not change the controller unless you choose a
rollback action first.

## Donations

The application supports one optional footer link. It does not show a modal,
auto prompt, floating badge, or startup message.

See [docs/DONATIONS.md](docs/DONATIONS.md) for the service comparison and
configuration steps. The recommended service is **Buy Me a Coffee** because
the donor flow is short and the public page works well across unrelated
applications.

## Privacy

Loopframe connects directly to the console address you enter. It has no
analytics, telemetry, relay, or hosted account service. Source files remain in
their original folder. Prepared GIFs and rollback records stay in the current
user's application data folder.

## Limitations

The background upload uses private Access routes used by the UniFi Access web
interface. A future Access release may change those routes. The published
Access Open API does not currently expose animated background upload.

## License

MIT. See [LICENSE](LICENSE).
