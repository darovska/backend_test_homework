/**
 * Google Play Billing bridge for the Cat Shelter HTML game.
 * The real-money checkout is disabled until VITE_PLAY_VERIFY_URL is set to an
 * HTTPS server using Google Play Developer API and a durable purchase ledger.
 * No demo or browser credit can be exchanged for real-money goods.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
const verifyUrl = String(import.meta.env.VITE_PLAY_VERIFY_URL || '').trim();
const isAvailable = isAndroid && /^https:\/\/[^/?#]+(?:\/[^?#]*)?$/i.test(verifyUrl);
const PRODUCT_IDS = ['shelter_supply_box','shelter_beds_3','shelter_groomer_kit','shelter_rescue_box'];

if (isAndroid) {
  const Billing = registerPlugin('ShelterBilling');
  window.ShelterBilling = {
    isNative: true,
    isAvailable,
    async getProducts() {
      if (!isAvailable) return [];
      const response = await Billing.getProducts();
      return (response.products || []).filter(p => PRODUCT_IDS.includes(p.productId));
    },
    async purchase(productId) {
      if (!isAvailable) throw new Error('Google Play Billing пока не настроен');
      if (!PRODUCT_IDS.includes(productId)) throw new Error('Неизвестный товар');
      return Billing.purchase({ productId });
    },
    async subscribe(callback) {
      if (!isAvailable) return;
      // The native event is delivered only after a completed Play purchase.
      // The game grants nothing until verifyPurchase() approves the token.
      return Billing.addListener('purchaseUpdated', callback);
    },
    async restore() {
      if (!isAvailable) return [];
      const result = await Billing.restore();
      return result.purchases || [];
    },
    async verifyPurchase(purchase) {
      if (!isAvailable || purchase.state !== 'PURCHASED' ||
          !PRODUCT_IDS.includes(purchase.productId) || !purchase.token) return false;
      const response = await fetch(verifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(window.ShelterPlayerAuth?.token
            ? {'Authorization': `Bearer ${window.ShelterPlayerAuth.token}`}
            : {})
        },
        body: JSON.stringify({
          platform: 'google-play',
          packageName: 'com.kindhands.catshelter',
          productId: purchase.productId,
          token: purchase.token,
        }),
      });
      if (!response.ok) throw new Error('Покупку не удалось подтвердить на сервере');
      const verified = await response.json();
      return verified.verified === true &&
        verified.productId === purchase.productId &&
        verified.token === purchase.token &&
        typeof verified.deliveryId === 'string' && !!verified.deliveryId;
    },
    async finish(token, consumable) {
      if (!isAvailable) throw new Error('Billing disabled');
      return Billing.finish({token, consumable: !!consumable});
    }
  };
  // Request pricing and restores when the game starts. Avoid silent grant.
  Billing.addListener('billingError', event => console.warn('Play Billing:', event?.message));
}
