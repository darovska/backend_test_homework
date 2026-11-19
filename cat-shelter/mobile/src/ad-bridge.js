/**
 * Native rewarded & interstitial ad adapter for Capacitor 8 / AdMob 8.
 * IMPORTANT: Google sample IDs are for testing ONLY. Replace all app/ad-unit
 * identifiers before publishing and configure GDPR/UMP + store privacy forms.
 * Never grant a reward on close/dismiss/error; only after earned reward.
 */
import { Capacitor } from '@capacitor/core';
import { AdMob, AdmobConsentStatus } from '@capacitor-community/admob';

const TEST_IDS = {
  android: {
    rewarded: 'ca-app-pub-3940256099942544/5224354917',
    interstitial: 'ca-app-pub-3940256099942544/1033173712',
  },
  ios: {
    rewarded: 'ca-app-pub-3940256099942544/1712485313',
    interstitial: 'ca-app-pub-3940256099942544/4411468910',
  },
};

// Set these to your real publisher IDs only after configuring an AdMob account.
const adUnits = TEST_IDS[Capacitor.getPlatform()] || TEST_IDS.android;
const isNative = Capacitor.isNativePlatform();
let readyPromise = null;

async function ensureInitialized() {
  if (!isNative) return false;
  if (!readyPromise) {
    readyPromise = (async () => {
      try {
        // UMP consent is mandatory before requesting ads where applicable.
        // Publish a GDPR message in the AdMob console first.
        let consent = await AdMob.requestConsentInfo();
        if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
          consent = await AdMob.showConsentForm();
        }
        if (!consent.canRequestAds) return false;
        await AdMob.initialize();
        return true;
      } catch (error) {
        console.warn('Native ads not initialized:', error);
        readyPromise = null; // allow retry after activity resumes
        return false;
      }
    })();
  }
  return readyPromise;
}

if (isNative) {
  window.ShelterAds = {
    async rewarded(placement) {
      console.log('Ad Triggered (native rewarded):', placement);
      if (!(await ensureInitialized())) return false;
      try {
        await AdMob.prepareRewardVideoAd({ adId: adUnits.rewarded, isTesting: true });
        const reward = await AdMob.showRewardVideoAd();
        return !!reward && Number(reward.amount) > 0;
      } catch (error) {
        // Dismissal, failed load, missing network => no earned reward.
        console.warn('Reward not earned:', error);
        return false;
      }
    },
    async interstitial() {
      if (!(await ensureInitialized())) return false;
      try {
        await AdMob.prepareInterstitial({ adId: adUnits.interstitial, isTesting: true });
        await AdMob.showInterstitial();
        return true;
      } catch (error) {
        console.warn('Interstitial unavailable:', error);
        return false;
      }
    },
    async privacyOptions() {
      if (!(await ensureInitialized())) return false;
      try { await AdMob.showPrivacyOptionsForm(); return true; } catch { return false; }
    },
  };
}
