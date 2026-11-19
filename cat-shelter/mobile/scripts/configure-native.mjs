/** Add TEST AdMob application IDs after cap add. Replace before publication. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const android = 'android/app/src/main/AndroidManifest.xml';
const ios = 'ios/App/App/Info.plist';
if (existsSync(android)) {
  let xml = readFileSync(android, 'utf8');
  if (!xml.includes('com.google.android.gms.ads.APPLICATION_ID')) {
    const meta = '        <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="ca-app-pub-3940256099942544~3347511713" />\n';
    xml = xml.replace(/<application\b[^>]*>/, v => v + '\n' + meta);
    writeFileSync(android, xml);
  }
  console.log('Android test AdMob App ID configured. MUST replace for production.');
}
if (existsSync(ios)) {
  let xml = readFileSync(ios, 'utf8');
  if (!xml.includes('GADApplicationIdentifier')) {
    const meta = '\t<key>GADApplicationIdentifier</key>\n\t<string>ca-app-pub-3940256099942544~1458002511</string>\n\t<key>NSUserTrackingUsageDescription</key>\n\t<string>Рекламные показы помогают поддерживать приют в игре.</string>\n';
    xml = xml.replace('</dict>', meta + '</dict>');
    writeFileSync(ios, xml);
  }
  console.log('iOS test AdMob App ID configured. MUST replace for production.');
}
