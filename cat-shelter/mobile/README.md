# Android/iOS project V6

`npm install && npm run android:create && npm run android:open`

The Android create script patches the generated Capacitor 8 project with Google Play Billing Library 9.1.0 and a custom Java plugin. Run `npm run sync` after changing the game source; `npm run billing:install` to re-patch existing Android output.

Play product catalog is in root `PLAY_STORE_SETUP_RU.md` and `SHOP_ECONOMY_RU.md`. **Paid checkout is intentionally disabled by default until an HTTPS purchase verification backend is configured** via `VITE_PLAY_VERIFY_URL`; local test bypass (`VITE_LOCAL_IAP_TEST=true`) is never allowed in production.

Native ads: `src/ad-bridge.js` uses TEST AdMob IDs and a consent check. Replace IDs and configure privacy before release. iOS IAP (StoreKit) is not implemented; only in-game currency and rewarded ads are available there.

The Google Play and App Store packages are **source projects**, not store-signed builds.
