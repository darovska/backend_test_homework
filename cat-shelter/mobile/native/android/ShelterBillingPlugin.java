package com.kindhands.catshelter;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.android.billingclient.api.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Official Google Play Billing 9.1 adapter for the Cat Shelter game.
 * Only launches the platform purchase UI and returns a real purchase token.
 * Verify tokens on YOUR BACKEND with Google Play Developer API before granting.
 * Consumption/acknowledgement occurs after JS persists verified entitlements.
 */
@CapacitorPlugin(name = "ShelterBilling")
public class ShelterBillingPlugin extends Plugin implements PurchasesUpdatedListener {
    private static final List<String> SKUS = Arrays.asList(
        "shelter_supply_box", "shelter_beds_3", "shelter_groomer_kit", "shelter_rescue_box"
    );
    private BillingClient client;
    private boolean connecting = false;
    private final ArrayList<PendingAction> queued = new ArrayList<>();

    private static class PendingAction {
        PluginCall call; Runnable action;
        PendingAction(PluginCall c, Runnable a) { call = c; action = a; }
    }

    @Override
    public void load() {
        client = BillingClient.newBuilder(getContext())
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build();
    }

    private void ready(PluginCall call, Runnable action) {
        if (client == null) { call.reject("Google Play Billing not initialized"); return; }
        if (client.isReady()) { action.run(); return; }
        queued.add(new PendingAction(call, action));
        if (connecting) return;
        connecting = true;
        client.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult result) {
                connecting = false;
                ArrayList<PendingAction> actions = new ArrayList<>(queued);
                queued.clear();
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    for (PendingAction a: actions) a.call.reject("Google Play Billing connection error: " + result.getResponseCode());
                    return;
                }
                for (PendingAction a: actions) a.action.run();
            }
            @Override public void onBillingServiceDisconnected() {
                // Auto-reconnection will handle the next operation.
                connecting = false;
            }
        });
    }

    private QueryProductDetailsParams makeQuery(List<String> ids) {
        ArrayList<QueryProductDetailsParams.Product> products = new ArrayList<>();
        for (String id : ids) {
            products.add(QueryProductDetailsParams.Product.newBuilder()
                .setProductId(id).setProductType(BillingClient.ProductType.INAPP).build());
        }
        return QueryProductDetailsParams.newBuilder().setProductList(products).build();
    }

    private ProductDetails.OneTimePurchaseOfferDetails firstOffer(ProductDetails item) {
        List<ProductDetails.OneTimePurchaseOfferDetails> offers = item.getOneTimePurchaseOfferDetailsList();
        if (offers == null || offers.isEmpty()) return null;
        return offers.get(0); // Play Console: configure ONE standard purchase option per product.
    }

    @PluginMethod
    public void getProducts(PluginCall call) {
        ready(call, () -> client.queryProductDetailsAsync(makeQuery(SKUS), (result, response) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                call.reject("Products unavailable: " + result.getResponseCode()); return;
            }
            JSArray products = new JSArray();
            for (ProductDetails p : response.getProductDetailsList()) {
                ProductDetails.OneTimePurchaseOfferDetails offer = firstOffer(p);
                if (offer == null) continue;
                JSObject entry = new JSObject();
                entry.put("productId", p.getProductId());
                entry.put("name", p.getName());
                entry.put("description", p.getDescription());
                entry.put("price", offer.getFormattedPrice());
                entry.put("currencyCode", offer.getPriceCurrencyCode());
                entry.put("priceMicros", offer.getPriceAmountMicros());
                products.put(entry);
            }
            JSObject data = new JSObject();data.put("products", products);call.resolve(data);
        }));
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        final String id = call.getString("productId", "");
        if (!SKUS.contains(id)) { call.reject("Unknown product"); return; }
        ready(call, () -> client.queryProductDetailsAsync(makeQuery(Arrays.asList(id)), (res, query) -> {
            if (res.getResponseCode() != BillingClient.BillingResponseCode.OK || query.getProductDetailsList().isEmpty()) {
                call.reject("This item is not available in Google Play"); return;
            }
            ProductDetails p = query.getProductDetailsList().get(0);
            ProductDetails.OneTimePurchaseOfferDetails offer = firstOffer(p);
            if (offer == null) { call.reject("No eligible purchase offer"); return; }
            BillingFlowParams.ProductDetailsParams detail = BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(p).setOfferToken(offer.getOfferToken()).build();
            BillingFlowParams flow = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(Arrays.asList(detail)).build();
            getActivity().runOnUiThread(() -> {
                BillingResult launched = client.launchBillingFlow(getActivity(), flow);
                if (launched.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    JSObject data = new JSObject();data.put("started", true);call.resolve(data);
                } else if (launched.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
                    call.reject("Purchase canceled");
                } else {
                    call.reject("Could not open Play checkout: " + launched.getResponseCode());
                }
            });
        }));
    }

    private JSObject toJSON(Purchase purchase) {
        JSObject data = new JSObject();
        if (purchase.getProducts().isEmpty()) return data;
        data.put("productId", purchase.getProducts().get(0));
        data.put("token", purchase.getPurchaseToken());
        data.put("state", purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED ? "PURCHASED" : "PENDING");
        data.put("acknowledged", purchase.isAcknowledged());
        return data;
    }

    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (Purchase p : purchases) notifyListeners("purchaseUpdated", toJSON(p), true);
        } else if (result.getResponseCode() != BillingClient.BillingResponseCode.USER_CANCELED) {
            JSObject error = new JSObject();error.put("message", "Purchase not completed: " + result.getResponseCode());
            notifyListeners("billingError", error, true);
        }
    }

    @PluginMethod
    public void restore(PluginCall call) {
        ready(call, () -> {
            QueryPurchasesParams query = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP).build();
            client.queryPurchasesAsync(query, (result, purchases) -> {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    call.reject("Could not restore purchases"); return;
                }
                JSArray active = new JSArray();
                for (Purchase p: purchases) if (!p.getProducts().isEmpty()) active.put(toJSON(p));
                JSObject data = new JSObject(); data.put("purchases", active); call.resolve(data);
            });
        });
    }

    @PluginMethod
    public void finish(PluginCall call) {
        final String token = call.getString("token", "");
        final Boolean consumable = call.getBoolean("consumable", false);
        if (token.isEmpty()) { call.reject("Missing purchase token"); return; }
        ready(call, () -> {
            if (consumable) {
                ConsumeParams params = ConsumeParams.newBuilder().setPurchaseToken(token).build();
                client.consumeAsync(params, (result, purchaseToken) -> {
                    if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) call.resolve();
                    else call.reject("Consume failed; retry restore: " + result.getResponseCode());
                });
            } else {
                AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
                    .setPurchaseToken(token).build();
                client.acknowledgePurchase(params, result -> {
                    if (result.getResponseCode() == BillingClient.BillingResponseCode.OK ||
                        result.getResponseCode() == BillingClient.BillingResponseCode.ITEM_NOT_OWNED) call.resolve();
                    else call.reject("Acknowledge failed; retry restore: " + result.getResponseCode());
                });
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (client != null) client.endConnection();
        super.handleOnDestroy();
    }
}