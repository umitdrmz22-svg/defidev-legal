#!/usr/bin/env python3
"""Apply the tested DefiDev consumer Play Billing + AdMob/UMP baseline.

Designed for the native Jetpack Compose apps in the DefiDev repository set.
The script is idempotent and is intended to run in GitHub Actions before tests.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path.cwd()
GRADLE = ROOT / "app" / "build.gradle.kts"
MANIFEST = ROOT / "app" / "src" / "main" / "AndroidManifest.xml"
SAMPLE_APP = "ca-app-pub-3940256099942544~3347511713"
SAMPLE_BANNER = "ca-app-pub-3940256099942544/6300978111"
PRIVACY = "https://umitdrmz22-svg.github.io/defidev-legal/privacy-consumer.html"


def fail(msg: str) -> None:
    raise SystemExit(msg)


def block_end(text: str, open_brace_index: int) -> int:
    depth = 0
    in_string = False
    escaped = False
    for i in range(open_brace_index, len(text)):
        ch = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
    fail("Unbalanced Gradle block")
    return -1


def inject_into_named_block(text: str, block_name: str, marker: str, snippet: str) -> str:
    if marker in text:
        return text
    m = re.search(rf"\b{re.escape(block_name)}\s*\{{", text)
    if not m:
        fail(f"Could not find {block_name} block")
    open_idx = text.find("{", m.start())
    close_idx = block_end(text, open_idx)
    return text[:close_idx] + "\n" + snippet.rstrip() + "\n" + text[close_idx:]


def patch_gradle() -> str:
    text = GRADLE.read_text(encoding="utf-8")
    ns = re.search(r'\bnamespace\s*=\s*"([^"]+)"', text)
    if not ns:
        fail("Android namespace not found")
    package = ns.group(1)

    placeholders = f'''        // DefiDev Play monetization: use per-app production IDs in release CI.
        manifestPlaceholders["ADMOB_APP_ID"] = System.getenv("ADMOB_APP_ID")
            ?: "{SAMPLE_APP}"
        manifestPlaceholders["ADMOB_BANNER_ID"] = System.getenv("ADMOB_BANNER_ID")
            ?: "{SAMPLE_BANNER}"'''
    text = inject_into_named_block(text, "defaultConfig", "ADMOB_APP_ID", placeholders)

    deps = '''    // Google Play monetization baseline (August 2026).
    implementation("com.android.billingclient:billing:9.1.0")
    implementation("com.google.android.gms:play-services-ads:25.4.0")
    implementation("com.google.android.ump:user-messaging-platform:4.0.0")'''
    text = inject_into_named_block(text, "dependencies", "com.android.billingclient:billing:9.1.0", deps)
    GRADLE.write_text(text, encoding="utf-8")
    return package


def patch_manifest() -> None:
    text = MANIFEST.read_text(encoding="utf-8")
    permissions = []
    if "android.permission.INTERNET" not in text:
        permissions.append('    <uses-permission android:name="android.permission.INTERNET" />')
    if "android.permission.ACCESS_NETWORK_STATE" not in text:
        permissions.append('    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />')
    if permissions:
        pos = text.find(">", text.find("<manifest")) + 1
        text = text[:pos] + "\n" + "\n".join(permissions) + text[pos:]

    if "com.google.android.gms.ads.APPLICATION_ID" not in text:
        app_start = text.find("<application")
        if app_start < 0:
            fail("<application> not found")
        app_end = text.find(">", app_start)
        if app_end < 0:
            fail("Malformed <application>")
        additions = '''
        <meta-data
            android:name="com.google.android.gms.ads.APPLICATION_ID"
            android:value="${ADMOB_APP_ID}" />
        <meta-data
            android:name="com.defidev.ADMOB_BANNER_ID"
            android:value="${ADMOB_BANNER_ID}" />
        <provider
            android:name=".MonetizationBootstrapProvider"
            android:authorities="${applicationId}.defidev.monetization-init"
            android:exported="false"
            android:initOrder="100" />'''
        text = text[: app_end + 1] + additions + text[app_end + 1 :]
    MANIFEST.write_text(text, encoding="utf-8")


def controller_source(package: str) -> str:
    return f'''package {package}

import android.app.Activity
import android.app.Application
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.database.Cursor
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.MobileAds
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import java.lang.ref.WeakReference

object MonetizationController {{
    private const val PRODUCT_ID = "remove_ads"
    private const val PREFS = "defidev_monetization"
    private const val PREF_OWNED = "remove_ads_owned"
    private const val META_BANNER_ID = "com.defidev.ADMOB_BANNER_ID"
    private const val SAMPLE_BANNER_ID = "{SAMPLE_BANNER}"
    private const val PRIVACY_URL = "{PRIVACY}"

    private var appContext: Context? = null
    private var currentActivity = WeakReference<Activity>(null)
    private var billingClient: BillingClient? = null
    private var productDetails: ProductDetails? = null
    private var consentInformation: ConsentInformation? = null
    private var billingStarted = false
    private var consentStarted = false
    private var adsInitialized = false
    private var owned = false
    private var purchaseButton: Button? = null
    private var privacyOptionsButton: Button? = null
    private var adContainer: FrameLayout? = null
    private var adView: AdView? = null
    private var statusText: TextView? = null

    fun attach(activity: Activity) {{
        currentActivity = WeakReference(activity)
        if (appContext == null) {{
            appContext = activity.applicationContext
            owned = prefs().getBoolean(PREF_OWNED, false)
        }}
        activity.window.decorView.post {{ attachBottomBar(activity); refreshUi() }}
        startBillingIfNeeded()
        startConsentIfNeeded(activity)
    }}

    private fun startBillingIfNeeded() {{
        val context = appContext ?: return
        if (billingStarted) return
        billingStarted = true
        billingClient = BillingClient.newBuilder(context)
            .setListener {{ result, purchases ->
                if (result.responseCode == BillingClient.BillingResponseCode.OK && purchases != null) processPurchases(purchases)
            }}
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build()
            .also {{ client ->
                client.startConnection(object : BillingClientStateListener {{
                    override fun onBillingSetupFinished(result: BillingResult) {{
                        if (result.responseCode == BillingClient.BillingResponseCode.OK) {{ queryOwnedPurchases(client); queryProduct(client) }}
                        else setStatus("Google Play Billing derzeit nicht verfügbar")
                    }}
                    override fun onBillingServiceDisconnected() = Unit
                }})
            }}
    }}

    private fun queryOwnedPurchases(client: BillingClient) {{
        val params = QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()
        client.queryPurchasesAsync(params) {{ result, purchases ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) {{
                val matching = purchases.filter {{ it.products.contains(PRODUCT_ID) && it.purchaseState == Purchase.PurchaseState.PURCHASED }}
                owned = matching.isNotEmpty()
                prefs().edit().putBoolean(PREF_OWNED, owned).apply()
                matching.forEach(::acknowledgeIfRequired)
                runOnUi(::refreshUi)
            }}
        }}
    }}

    private fun queryProduct(client: BillingClient) {{
        val product = QueryProductDetailsParams.Product.newBuilder().setProductId(PRODUCT_ID).setProductType(BillingClient.ProductType.INAPP).build()
        val params = QueryProductDetailsParams.newBuilder().setProductList(listOf(product)).build()
        client.queryProductDetailsAsync(params) {{ result, queryResult ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) {{
                productDetails = queryResult.productDetailsList.firstOrNull()
                runOnUi(::refreshUi)
            }}
        }}
    }}

    private fun launchPurchase() {{
        if (owned) return
        val activity = currentActivity.get() ?: return
        val client = billingClient ?: return
        val details = productDetails ?: run {{ Toast.makeText(activity, "Produkt noch nicht in Google Play aktiviert", Toast.LENGTH_LONG).show(); return }}
        val offer = details.oneTimePurchaseOfferDetailsList?.firstOrNull() ?: details.oneTimePurchaseOfferDetails
            ?: run {{ Toast.makeText(activity, "Kein verfügbares Kaufangebot", Toast.LENGTH_LONG).show(); return }}
        val detailBuilder = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(details)
        offer.offerToken?.takeIf {{ it.isNotBlank() }}?.let {{ detailBuilder.setOfferToken(it) }}
        val flow = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(detailBuilder.build())).setIsOfferPersonalized(false).build()
        val result = client.launchBillingFlow(activity, flow)
        if (result.responseCode != BillingClient.BillingResponseCode.OK) Toast.makeText(activity, result.debugMessage, Toast.LENGTH_LONG).show()
    }}

    private fun processPurchases(purchases: List<Purchase>) {{
        val matching = purchases.filter {{ it.products.contains(PRODUCT_ID) && it.purchaseState == Purchase.PurchaseState.PURCHASED }}
        if (matching.isEmpty()) return
        owned = true
        prefs().edit().putBoolean(PREF_OWNED, true).apply()
        matching.forEach(::acknowledgeIfRequired)
        runOnUi(::refreshUi)
    }}

    private fun acknowledgeIfRequired(purchase: Purchase) {{
        if (purchase.isAcknowledged) return
        val client = billingClient ?: return
        client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(purchase.purchaseToken).build()) {{ result ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) setStatus("Kaufbestätigung wird erneut geprüft")
        }}
    }}

    private fun startConsentIfNeeded(activity: Activity) {{
        if (consentStarted) return
        consentStarted = true
        val consent = UserMessagingPlatform.getConsentInformation(activity)
        consentInformation = consent
        consent.requestConsentInfoUpdate(activity, ConsentRequestParameters.Builder().build(), {{
            UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) {{ maybeInitializeAds(activity); refreshUi() }}
        }}, {{ maybeInitializeAds(activity); refreshUi() }})
        if (consent.canRequestAds()) maybeInitializeAds(activity)
    }}

    private fun maybeInitializeAds(activity: Activity) {{
        val consent = consentInformation ?: return
        if (!consent.canRequestAds() || owned || adsInitialized) return
        val bannerId = bannerId(activity)
        if (!isAdConfigurationUsable(activity, bannerId)) {{ setStatus("AdMob Produktions-ID noch einzutragen"); return }}
        adsInitialized = true
        MobileAds.initialize(activity.applicationContext) {{ runOnUi {{ loadBannerIfNeeded(activity, bannerId) }} }}
    }}

    private fun loadBannerIfNeeded(activity: Activity, bannerId: String) {{
        if (owned || adView != null) return
        val container = adContainer ?: return
        adView = AdView(activity).also {{ view ->
            view.adUnitId = bannerId
            view.setAdSize(AdSize.BANNER)
            container.removeAllViews()
            container.addView(view, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
            view.loadAd(AdRequest.Builder().build())
        }}
    }}

    private fun showPrivacyOptionsOrPolicy() {{
        val activity = currentActivity.get() ?: return
        val required = consentInformation?.privacyOptionsRequirementStatus == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED
        if (required) UserMessagingPlatform.showPrivacyOptionsForm(activity) {{ if (consentInformation?.canRequestAds() == true) maybeInitializeAds(activity); refreshUi() }}
        else activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(PRIVACY_URL)))
    }}

    private fun openPrivacyPolicy() {{ currentActivity.get()?.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(PRIVACY_URL))) }}

    private fun attachBottomBar(activity: Activity) {{
        val root = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
        if (root.findViewWithTag<View>("defidev-monetization") != null) return
        val d = activity.resources.displayMetrics.density
        val bar = LinearLayout(activity).apply {{ tag = "defidev-monetization"; orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.WHITE); elevation = 10*d; setPadding((10*d).toInt(), (6*d).toInt(), (10*d).toInt(), (6*d).toInt()) }}
        val actions = LinearLayout(activity).apply {{ orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }}
        purchaseButton = Button(activity).apply {{ setOnClickListener {{ launchPurchase() }} }}
        val privacyButton = Button(activity).apply {{ text = "Datenschutz"; setOnClickListener {{ openPrivacyPolicy() }} }}
        privacyOptionsButton = Button(activity).apply {{ text = "Optionen"; setOnClickListener {{ showPrivacyOptionsOrPolicy() }} }}
        actions.addView(purchaseButton, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        actions.addView(privacyButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        actions.addView(privacyOptionsButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        bar.addView(actions)
        statusText = TextView(activity).apply {{ gravity = Gravity.CENTER; textSize = 11f; visibility = View.GONE }}
        bar.addView(statusText)
        adContainer = FrameLayout(activity).apply {{ minimumHeight = (50*d).toInt() }}
        bar.addView(adContainer, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        root.addView(bar, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        root.getChildAt(0)?.takeIf {{ it !== bar }}?.let {{ content ->
            val extra = if (owned) 58 else 112
            content.setPadding(content.paddingLeft, content.paddingTop, content.paddingRight, content.paddingBottom + (extra*d).toInt())
        }}
    }}

    private fun refreshUi() {{
        val activity = currentActivity.get() ?: return
        if (activity.isFinishing || activity.isDestroyed) return
        runOnUi {{
            val offer = productDetails?.oneTimePurchaseOfferDetailsList?.firstOrNull() ?: productDetails?.oneTimePurchaseOfferDetails
            purchaseButton?.apply {{ isEnabled = !owned && productDetails != null; text = when {{ owned -> "Werbefrei aktiviert"; offer != null -> "Werbung entfernen · ${{offer.formattedPrice}}"; else -> "Werbung entfernen" }} }}
            val privacyRequired = consentInformation?.privacyOptionsRequirementStatus == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED
            privacyOptionsButton?.visibility = if (privacyRequired) View.VISIBLE else View.GONE
            adContainer?.visibility = if (owned) View.GONE else View.VISIBLE
            if (owned) {{ adView?.destroy(); adView = null; statusText?.visibility = View.GONE }}
            else if (consentInformation?.canRequestAds() == true) maybeInitializeAds(activity)
        }}
    }}

    private fun setStatus(message: String) {{ runOnUi {{ statusText?.text = message; statusText?.visibility = View.VISIBLE }} }}
    private fun prefs() = requireNotNull(appContext).getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Suppress("DEPRECATION")
    private fun bannerId(context: Context): String {{
        val info = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
        return info.metaData?.getString(META_BANNER_ID).orEmpty()
    }}
    private fun isAdConfigurationUsable(context: Context, bannerId: String): Boolean {{
        if (bannerId.isBlank()) return false
        val debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        return debuggable || bannerId != SAMPLE_BANNER_ID
    }}
    private fun runOnUi(block: () -> Unit) {{ currentActivity.get()?.runOnUiThread(block) }}
}}

class MonetizationBootstrapProvider : ContentProvider() {{
    override fun onCreate(): Boolean {{
        val application = context?.applicationContext as? Application ?: return false
        application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {{
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
            override fun onActivityStarted(activity: Activity) = Unit
            override fun onActivityResumed(activity: Activity) = MonetizationController.attach(activity)
            override fun onActivityPaused(activity: Activity) = Unit
            override fun onActivityStopped(activity: Activity) = Unit
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
            override fun onActivityDestroyed(activity: Activity) = Unit
        }})
        return true
    }}
    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}}
'''


def write_controller(package: str) -> None:
    target = ROOT / "app" / "src" / "main" / "java" / Path(*package.split(".")) / "MonetizationController.kt"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(controller_source(package), encoding="utf-8")


def write_guide(package: str) -> None:
    guide = f"""# Play Console / AdMob — {package}

## Product
- One-time product ID: `remove_ads`
- Type: non-consumable / one-time product
- Activate the product in this app's Play Console entry.

## AdMob
Create a separate AdMob app and banner unit for this Android package. Never reuse another app's production IDs.
Provide release CI environment values `ADMOB_APP_ID` and `ADMOB_BANNER_ID`. Debug builds intentionally use Google's sample IDs.

## Privacy
Privacy policy: {PRIVACY}
The app requests UMP consent information before loading ads and exposes privacy options when required.

## Release gate
Before public production release: configure the unique AdMob IDs, activate `remove_ads`, complete Data safety consistently with the actual permissions/SDKs, and perform a licensed Play test purchase.
"""
    (ROOT / "PLAY_CONSOLE_MONETIZATION.md").write_text(guide, encoding="utf-8")


def main() -> None:
    if not GRADLE.exists() or not MANIFEST.exists():
        fail("This repository does not look like the expected native Android app")
    package = patch_gradle()
    patch_manifest()
    write_controller(package)
    write_guide(package)
    print(f"Applied DefiDev consumer monetization baseline to {package}")


if __name__ == "__main__":
    main()
