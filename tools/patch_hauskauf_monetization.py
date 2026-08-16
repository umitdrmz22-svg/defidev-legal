#!/usr/bin/env python3
from pathlib import Path
import json

root = Path.cwd()
app_path = root / 'app.json'
index_path = root / 'index.ts'
privacy_path = root / 'public' / 'datenschutz.html'
data_safety_path = root / 'docs' / 'PLAY_DATA_SAFETY.md'

if not app_path.exists() or not index_path.exists():
    raise SystemExit('Hauskauf project files not found')

app = json.loads(app_path.read_text(encoding='utf-8'))
expo = app['expo']
plugins = expo.setdefault('plugins', [])

def plugin_name(item):
    return item if isinstance(item, str) else item[0]

plugins = [p for p in plugins if plugin_name(p) not in {
    'expo-iap', 'expo-build-properties', 'react-native-google-mobile-ads'
}]
plugins += [
    'expo-iap',
    ['expo-build-properties', {
        'android': {
            'extraProguardRules': '-keep class com.google.android.gms.internal.consent_sdk.** { *; }'
        }
    }],
    ['react-native-google-mobile-ads', {
        'androidAppId': 'ca-app-pub-3940256099942544~3347511713',
        'delayAppMeasurementInit': True
    }],
]
expo['plugins'] = plugins
android = expo.setdefault('android', {})
android['blockedPermissions'] = [
    permission for permission in android.get('blockedPermissions', [])
    if permission != 'com.google.android.gms.permission.AD_ID'
]
app_path.write_text(json.dumps(app, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

index = index_path.read_text(encoding='utf-8')
index = index.replace("import App from './App';", "import App from './src/monetization/MonetizedApp';")
index_path.write_text(index, encoding='utf-8')

if privacy_path.exists():
    privacy = privacy_path.read_text(encoding='utf-8')
    privacy = privacy.replace(
        'Es gibt derzeit kein Nutzerkonto, kein Werbe-SDK und kein Analyse-/Tracking-SDK in der App.',
        'Es gibt derzeit kein Nutzerkonto. Die kostenlose Android-Version kann Google AdMob für Werbung verwenden; die werbefreie Freischaltung erfolgt als einmaliger In-App-Kauf über Google Play Billing. Die fachliche Immobilienanalyse selbst wird nicht für Werbeprofile verwendet.',
    )
    marker = '<section class="card"><h2>Standortberechtigung</h2>'
    extra = '''<section class="card"><h2>Werbung, Einwilligung und Google UMP</h2><p>In der kostenlosen Android-Version kann Google AdMob eingesetzt werden. Vor der Anzeigeninitialisierung wird der für die Region maßgebliche Einwilligungsstatus über die Google User Messaging Platform (UMP) abgefragt. Soweit eine Einwilligung erforderlich ist, werden Anzeigen erst nach dem von UMP gemeldeten zulässigen Status angefordert. Eine erteilte Auswahl kann über die in der App angebotenen Datenschutzoptionen geändert werden. Abhängig von Einwilligung und Anzeigenmodus können insbesondere IP-Adresse, Geräte-/App-Informationen, Werbe-ID, Diagnoseinformationen und Anzeigeninteraktionen durch Google verarbeitet werden. Anbieter für Nutzer im EWR ist Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland. Rechtsgrundlagen sind – je nach Verarbeitung – insbesondere Art. 6 Abs. 1 lit. a DSGVO und § 25 Abs. 1 TDDDG; technisch erforderliche Vorgänge können auf einer anderen einschlägigen Rechtsgrundlage beruhen.</p></section>\n\n<section class="card"><h2>Google Play Billing / Werbung entfernen</h2><p>Für den einmaligen Kauf „Werbung entfernen“ wird Google Play Billing verwendet. Zahlungsdaten werden nicht von Hauskauf Kompass erhoben oder gespeichert. Google Play verarbeitet die Zahlung; die App erhält technische Informationen zum Produkt und Kaufstatus. Die Verarbeitung dient der Vertragserfüllung nach Art. 6 Abs. 1 lit. b DSGVO. Ein erworbener nicht verbrauchbarer Kauf kann über das Google-Play-Konto wiederhergestellt werden.</p></section>\n\n'''
    if 'Google Play Billing / Werbung entfernen' not in privacy:
        privacy = privacy.replace(marker, extra + marker)
    privacy = privacy.replace(
        'Eine Nutzung der Immobilienadresse für Werbung oder Nutzerprofile ist nicht vorgesehen.',
        'Eine Nutzung der eingegebenen Immobilienadresse für Werbeprofile ist nicht vorgesehen. AdMob verarbeitet seine eigenen technischen Werbe- und Geräteinformationen getrennt von der fachlichen Immobilienanalyse.',
    )
    privacy = privacy.replace(
        'Stand: 11.08.2026 · Technische Vorabfassung.',
        'Stand: 16.08.2026 · Technische Vorabfassung.',
    )
    privacy_path.write_text(privacy, encoding='utf-8')

if data_safety_path.exists():
    data = data_safety_path.read_text(encoding='utf-8')
    data = data.replace('Stand: 14.08.2026', 'Stand: 16.08.2026')
    data = data.replace('- keine Advertising ID\n- kein Werbe-SDK\n- kein Analytics-/Tracking-SDK in der App\n', '')
    marker = '## Relevante vom Nutzer bereitgestellte Information\n'
    ads_section = '''## Werbung und Geräte-/Werbedaten\n\nDie kostenlose Android-Version enthält Google AdMob. Abhängig von Region, Einwilligungsstatus und Anzeigenmodus können Google bzw. eingebundene Werbepartner technische Geräte-/App-Informationen, IP-Adresse, Advertising ID/Werbe-ID, Diagnoseinformationen und Anzeigeninteraktionen verarbeiten. Diese Verarbeitung ist von der fachlichen Immobilienanalyse getrennt; die eingegebene Immobilienadresse wird von Hauskauf Kompass nicht an AdMob übergeben, um ein Werbeprofil zur Immobilie zu bilden.\n\nVor dem ersten Anzeigenabruf wird der Consent-Status über die Google User Messaging Platform (UMP) abgefragt. Der finale Play-Data-Safety-Fragebogen muss anhand des tatsächlich ausgelieferten AdMob-SDKs, der in AdMob gewählten Anzeigen-/Partnerkonfiguration und des Consent-Modus beantwortet werden.\n\nGoogle Play Billing verarbeitet für den einmaligen Kauf `hauskauf_remove_ads` technische Kauf-/Produktinformationen. Zahlungsdaten werden von Google Play verarbeitet und nicht von Hauskauf Kompass gespeichert.\n\n'''
    if '## Werbung und Geräte-/Werbedaten' not in data:
        data = data.replace(marker, ads_section + marker)
    data_safety_path.write_text(data, encoding='utf-8')

(root / 'PLAY_CONSOLE_MONETIZATION.md').write_text('''# Hauskauf Kompass — Google Play Monetarisierung

## Android-Paket
`com.umitdurmaz.hauskaufkompass`

## Einmalkauf
- Produkt-ID: `hauskauf_remove_ads`
- Typ: einmaliges, nicht verbrauchbares Produkt
- Vorgesehener Preis: 5,99 EUR; der verbindliche Preis wird in Google Play Console gepflegt.

## AdMob
Für Hauskauf Kompass muss eine eigene AdMob-App samt eigener Banner-Anzeigen-ID angelegt werden. Die Google-Test-ID ist ausschließlich für CI/Debug vorgesehen. Vor Production müssen die Sample-App-ID in `app.json` durch die echte Hauskauf-Kompass-AdMob-App-ID und `EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID` durch die echte Banner-ID ersetzt werden. Familio-IDs dürfen nicht wiederverwendet werden.

## Consent
Google UMP wird vor Anzeigeninitialisierung abgefragt; `delayAppMeasurementInit` ist aktiv. Datenschutzoptionen werden angeboten, wenn UMP sie verlangt.

## Freigabesperren
Production erst freigeben, wenn eigene AdMob-IDs gesetzt, `hauskauf_remove_ads` in Play aktiv, ein lizenzierter Testkauf erfolgreich, Data Safety aktualisiert und die vollständige ladungsfähige Anbieteranschrift im Impressum/Datenschutz eingetragen ist.

## Anti-Fraud-Härtung
Der Client stellt Käufe über Google Play wieder her und bestätigt sie. Vor größerer kommerzieller Skalierung soll die Purchase-Token-Prüfung zusätzlich serverseitig über die Google Play Developer API erfolgen.
''', encoding='utf-8')

print('Hauskauf monetization patch applied')
