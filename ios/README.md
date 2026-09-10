# Abhijatya POS for iPhone and iPad

This folder is the native Capacitor wrapper for the existing React POS. The web application remains the source of the screens and Supabase connection.

## Local workflow

1. Install the full Xcode app from the Mac App Store, then open it once and accept its licence.
2. Run `npm run ios:open` from the project root.
3. In Xcode, choose an Apple Development Team under **App → Signing & Capabilities**.
4. Connect an iPhone/iPad by cable, select it as the run destination, then press Run.

`npm run ios:sync` rebuilds the React app and copies the latest files into this iOS project.

## Printing status

The iOS wrapper has camera and Bluetooth permission descriptions. A native PSF-58D plugin is intentionally not included yet: it needs Shreyans' iOS SDK or the printer's BLE/MFi protocol details before the app can send raw 58 mm ESC/POS receipt data reliably.
