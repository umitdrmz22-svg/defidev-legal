import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Purchase, PurchaseError } from 'expo-iap';
import type { AdsConsentInfo } from 'react-native-google-mobile-ads';
import { BANNER_AD_UNIT_ID, REMOVE_ADS_PRODUCT_ID } from './config';
import { PRIVACY_URL } from '../config/product';

type IapModule = typeof import('expo-iap');
type AdsModule = typeof import('react-native-google-mobile-ads');

type MonetizationState = {
  adFree: boolean;
  adsReady: boolean;
  price: string | null;
  busy: boolean;
  privacyRequired: boolean;
  status: string | null;
  error: string | null;
  purchase: () => Promise<void>;
  restore: () => Promise<void>;
  privacy: () => Promise<void>;
};

const Ctx = createContext<MonetizationState | null>(null);
const CACHE_KEY = '@hauskauf-kompass/ad-free-v1';

function readable(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function cancelled(error: PurchaseError | unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      ['user-cancelled', 'E_USER_CANCELLED'].includes(String(error.code)),
  );
}

export function useHauskaufMonetization() {
  const value = useContext(Ctx);
  if (!value) throw new Error('HauskaufMonetizationProvider missing');
  return value;
}

export function HauskaufMonetizationProvider({ children }: PropsWithChildren) {
  const [adFree, setAdFree] = useState(false);
  const [adsReady, setAdsReady] = useState(false);
  const [price, setPrice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [privacyRequired, setPrivacyRequired] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const iapRef = useRef<IapModule | null>(null);
  const mounted = useRef(true);

  const saveEntitlement = useCallback(async (active: boolean) => {
    if (mounted.current) setAdFree(active);
    await AsyncStorage.setItem(CACHE_KEY, active ? 'true' : 'false');
  }, []);

  const finishPurchased = useCallback(async (purchase: Purchase, iap: IapModule) => {
    if (purchase.productId !== REMOVE_ADS_PRODUCT_ID) return false;
    if (purchase.purchaseState === 'pending') {
      setStatus('Google Play prüft die Zahlung noch. Werbung bleibt bis zur Bestätigung aktiv.');
      return false;
    }
    if (purchase.purchaseState !== 'purchased') return false;

    if (!('isAcknowledgedAndroid' in purchase) || !purchase.isAcknowledgedAndroid) {
      await iap.finishTransaction({ purchase, isConsumable: false });
    }
    await saveEntitlement(true);
    setStatus('Werbung wurde dauerhaft entfernt.');
    setError(null);
    return true;
  }, [saveEntitlement]);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let iap: IapModule | null = null;
    let purchaseSubscription: { remove: () => void } | null = null;
    let errorSubscription: { remove: () => void } | null = null;

    void AsyncStorage.getItem(CACHE_KEY).then((cached) => {
      if (!disposed) setAdFree(cached === 'true');
    });

    if (Platform.OS === 'android') {
      void (async () => {
        try {
          iap = await import('expo-iap');
          await iap.initConnection();
          if (disposed) return;
          iapRef.current = iap;

          purchaseSubscription = iap.purchaseUpdatedListener((purchase) => {
            setBusy(true);
            void finishPurchased(purchase, iap as IapModule)
              .catch((e) => setError(readable(e, 'Der Kauf konnte nicht bestätigt werden.')))
              .finally(() => setBusy(false));
          });
          errorSubscription = iap.purchaseErrorListener((e) => {
            setBusy(false);
            if (!cancelled(e)) setError(readable(e, 'Google Play konnte den Kauf nicht starten.'));
          });

          const products = await iap.fetchProducts({
            skus: [REMOVE_ADS_PRODUCT_ID],
            type: 'in-app',
          });
          if (!disposed) {
            setPrice(products?.find((product) => product.id === REMOVE_ADS_PRODUCT_ID)?.displayPrice ?? null);
          }

          const purchases = await iap.getAvailablePurchases();
          const existing = purchases.find((purchase) => purchase.productId === REMOVE_ADS_PRODUCT_ID);
          if (existing) await finishPurchased(existing, iap);
        } catch (e) {
          console.warn('Hauskauf Billing bootstrap', readable(e, 'unknown'));
        }
      })();
    }

    return () => {
      disposed = true;
      mounted.current = false;
      purchaseSubscription?.remove();
      errorSubscription?.remove();
      iapRef.current = null;
      if (iap) void iap.endConnection().catch(() => undefined);
    };
  }, [finishPurchased]);

  const initAds = useCallback(async (ads: AdsModule, info: AdsConsentInfo) => {
    setPrivacyRequired(
      info.privacyOptionsRequirementStatus ===
        ads.AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
    );
    if (!info.canRequestAds || !BANNER_AD_UNIT_ID) {
      setAdsReady(false);
      return;
    }
    await ads.default().setRequestConfiguration({
      maxAdContentRating: ads.MaxAdContentRating.PG,
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
      testDeviceIdentifiers: __DEV__ ? ['EMULATOR'] : [],
    });
    await ads.default().initialize();
    setAdsReady(true);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android' || adFree) {
      setAdsReady(false);
      return;
    }
    let disposed = false;
    void (async () => {
      try {
        const ads = await import('react-native-google-mobile-ads');
        let info: AdsConsentInfo;
        try {
          info = await ads.AdsConsent.gatherConsent({ tagForUnderAgeOfConsent: false });
        } catch {
          info = await ads.AdsConsent.getConsentInfo();
        }
        if (!disposed) await initAds(ads, info);
      } catch (e) {
        if (!disposed) console.warn('Hauskauf Ads bootstrap', readable(e, 'unknown'));
      }
    })();
    return () => {
      disposed = true;
    };
  }, [adFree, initAds]);

  const purchase = useCallback(async () => {
    setStatus(null);
    setError(null);
    if (Platform.OS !== 'android' || !iapRef.current) {
      setError('Google Play Billing ist auf diesem Gerät nicht verfügbar.');
      return;
    }
    if (!price) {
      setError('Das Produkt hauskauf_remove_ads ist in Google Play noch nicht für dieses Testkonto verfügbar.');
      return;
    }
    setBusy(true);
    try {
      await iapRef.current.requestPurchase({
        request: { google: { skus: [REMOVE_ADS_PRODUCT_ID] } },
        type: 'in-app',
      });
    } catch (e) {
      setBusy(false);
      if (!cancelled(e)) setError(readable(e, 'Google Play konnte den Kauf nicht starten.'));
    }
  }, [price]);

  const restore = useCallback(async () => {
    setStatus(null);
    setError(null);
    if (Platform.OS !== 'android' || !iapRef.current) return;
    setBusy(true);
    try {
      const purchases = await iapRef.current.getAvailablePurchases();
      const existing = purchases.find((purchase) => purchase.productId === REMOVE_ADS_PRODUCT_ID);
      if (existing) {
        await finishPurchased(existing, iapRef.current);
      } else {
        await saveEntitlement(false);
        setStatus('Kein früherer Kauf gefunden.');
      }
    } catch (e) {
      setError(readable(e, 'Käufe konnten nicht wiederhergestellt werden.'));
    } finally {
      setBusy(false);
    }
  }, [finishPurchased, saveEntitlement]);

  const privacy = useCallback(async () => {
    if (Platform.OS !== 'android') {
      await Linking.openURL(PRIVACY_URL);
      return;
    }
    try {
      const ads = await import('react-native-google-mobile-ads');
      if (privacyRequired) {
        const info = await ads.AdsConsent.showPrivacyOptionsForm();
        await initAds(ads, info);
      } else {
        await Linking.openURL(PRIVACY_URL);
      }
    } catch {
      await Linking.openURL(PRIVACY_URL);
    }
  }, [initAds, privacyRequired]);

  const value = useMemo(
    () => ({ adFree, adsReady, price, busy, privacyRequired, status, error, purchase, restore, privacy }),
    [adFree, adsReady, price, busy, privacyRequired, status, error, purchase, restore, privacy],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function HauskaufMonetizationFooter() {
  const m = useHauskaufMonetization();
  const [ads, setAds] = useState<AdsModule | null>(null);
  const showAd = Platform.OS === 'android' && !m.adFree && m.adsReady && Boolean(BANNER_AD_UNIT_ID);

  useEffect(() => {
    let disposed = false;
    if (showAd) {
      void import('react-native-google-mobile-ads').then((module) => {
        if (!disposed) setAds(module);
      });
    }
    return () => {
      disposed = true;
    };
  }, [showAd]);

  if (Platform.OS !== 'android') return null;
  const BannerAd = ads?.BannerAd;

  return (
    <View style={styles.footer}>
      {showAd && BannerAd && ads ? (
        <View style={styles.ad}>
          <Text style={styles.adLabel}>WERBUNG</Text>
          <BannerAd
            unitId={BANNER_AD_UNIT_ID}
            size={ads.BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            onAdFailedToLoad={(e) => console.warn('Hauskauf banner failed', e.message)}
          />
        </View>
      ) : null}
      <View style={styles.actions}>
        {!m.adFree ? (
          <Pressable disabled={m.busy || !m.price} onPress={() => void m.purchase()} style={styles.primary}>
            <Text style={styles.primaryText}>
              {m.busy ? 'Bitte warten …' : `Werbung entfernen${m.price ? ` · ${m.price}` : ''}`}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.adFree}>Werbefrei aktiviert</Text>
        )}
        <Pressable onPress={() => void m.restore()} style={styles.link}>
          <Text style={styles.linkText}>Kauf wiederherstellen</Text>
        </Pressable>
        <Pressable onPress={() => void m.privacy()} style={styles.link}>
          <Text style={styles.linkText}>{m.privacyRequired ? 'Datenschutzoptionen' : 'Datenschutz'}</Text>
        </Pressable>
      </View>
      {m.status ? <Text style={styles.status}>{m.status}</Text> : null}
      {m.error ? <Text style={styles.error}>{m.error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    backgroundColor: '#ffffff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#dce5e1',
    paddingBottom: 6,
  },
  ad: { alignItems: 'center', minHeight: 52 },
  adLabel: { fontSize: 8, fontWeight: '800', color: '#6d7d78', letterSpacing: 0.7 },
  actions: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 8,
  },
  primary: {
    minHeight: 38,
    justifyContent: 'center',
    backgroundColor: '#176b5b',
    borderRadius: 9,
    paddingHorizontal: 12,
  },
  primaryText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  link: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 8 },
  linkText: { color: '#176b5b', fontSize: 11, fontWeight: '700' },
  adFree: { color: '#176b5b', fontWeight: '800', fontSize: 12, paddingHorizontal: 8 },
  status: { color: '#365950', textAlign: 'center', fontSize: 10, paddingHorizontal: 10, paddingBottom: 3 },
  error: { color: '#9b2c2c', textAlign: 'center', fontSize: 10, paddingHorizontal: 10, paddingBottom: 3 },
});
