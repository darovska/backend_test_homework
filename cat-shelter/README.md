# Лапки добра / Cat Shelter: Kind Hands

Russian-language HTML5 cat-shelter simulation, with animated cats, adoptions,
grooming, supplies and furnishings bought with virtual coins, optional
rewarded ad bonuses and an Android Capacitor project.

## Browser demo

Serve `web/` as a static site, or open `index.html` directly. The site requires
no API keys and no JavaScript libraries. The same files are suitable for a
short (5+ minute) demo, without any forced timer or real-money checkout.

## Android

```sh
cd mobile
npm ci
npm run android:create
npm run android:open
```

For a test APK, run the **Build Android APK (debug)** GitHub Action on this
branch. Its APK artifact is *unsigned for store distribution* and must not
be uploaded directly to Google Play. Android Studio can create a signed AAB.

The game has a native AdMob adapter using Google's **test ad IDs**. Store
checkout is **disabled by default** until a remote receipt verification backend
is configured with `VITE_PLAY_VERIFY_URL`. See `PLAY_STORE_SETUP_RU.md` and
`SHOP_ECONOMY_RU.md`. Digital products are delivered only after successful
purchase and verification; web browser rewards are free simulation.

## iOS & Yandex Games

`mobile/` also has the shared Capacitor iOS source, but iOS real-money
StoreKit purchases are not implemented. `yandex/` is a separate SDK-integrated
HTML5 distribution build. Neither store distribution is automatic.

## Source structure

- `index.html` — complete portable game
- `web/` — website and PWA icons
- `mobile/` — Capacitor Android/iOS source, Play Billing bridge and native ads
- `yandex/` — web game with Yandex SDK
- `.github/workflows/android-debug.yml` — build-test Android APK
- `test-v6.cjs` — game logic smoke tests

## Privacy / publishing

The app saves game progress locally. Mobile advertising SDKs can process
additional information and require consent, correct store disclosures, and
an accessible privacy policy before store publication. None of the purchase
prices listed in the virtual store represent real cash.
