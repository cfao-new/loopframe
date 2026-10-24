# Platform Guide

## Supported Systems

| System | Processor | Package | First run |
| --- | --- | --- | --- |
| Windows 10 and 11 | Intel or AMD 64 bit | Portable EXE | Open the EXE |
| Linux | Intel or AMD 64 bit | AppImage | Mark executable, then open |
| macOS 12 or newer | Intel | ZIP | Open Loopframe.app |
| macOS 12 or newer | Apple Silicon | ZIP | Open Loopframe.app |

The application uses Electron, so the desktop runtime behaves consistently on
all three systems. Settings use the current user's application data folder.
Windows uses Credential Manager protection, macOS uses Keychain, and Linux uses
the desktop keyring when Electron reports it as available.

The packaged application does not need a separate runtime, installer, system
service, or administrator password. Linux AppImage users may extract and run
the package without FUSE.

## Linux From Source

Install Node.js 22 or newer with the package manager supplied by your Linux
distribution. Then run:

```bash
npm ci
npm start
```

No root access is required after Node.js is installed. To build an AppImage:

```bash
npm run pack:linux
chmod +x dist/Loopframe-1.0.0-x86_64.AppImage
./dist/Loopframe-1.0.0-x86_64.AppImage
```

If FUSE is unavailable on the target computer, run:

```bash
./dist/Loopframe-1.0.0-x86_64.AppImage --appimage-extract-and-run
```

## macOS From Source

Install Node.js 22 or newer from the official installer or Homebrew. Then run:

```bash
npm ci
npm start
```

To build ZIP packages:

```bash
npm run pack:mac
```

The command creates separate Intel and Apple Silicon packages. Open the
resulting ZIP, move Loopframe.app into Applications if desired, and open it.

Public macOS distribution should use an Apple Developer ID certificate and
notarization. Without those credentials, macOS may show a Gatekeeper warning.
This is an Apple platform requirement, not an installation requirement.

## Build Matrix

The repository includes a GitHub Actions workflow that builds:

1. Windows x64 portable EXE.
2. Linux x64 AppImage.
3. macOS Intel ZIP.
4. macOS Apple Silicon ZIP.

The workflow runs the local tests before creating release packages. A live
console test is separate because it changes real controller state.

The interface test covers artwork loading, all six catalog sizes at the
processor level, G6 Pro Entry and G4 Doorbell Pro preview shapes, both upload
transports, opt in Protect credentials, mouse drag, rollback, and local data
removal.

## No Admin Rule

The application never needs an operating system administrator password to
open, save settings, choose images, or publish a background. Installing Node.js
or an operating system package may use the system's normal package manager
policies. The packaged desktop application does not install a service or
register a system wide component.
