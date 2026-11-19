/** Patch Capacitor-generated Android app with official Play Billing 9.1 plugin.
 * Safe to rerun after 'npx cap add android' or on a sync.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
const path='android/app/src/main/java/com/kindhands/catshelter/';
const main=path+'MainActivity.java';
const plugin=path+'ShelterBillingPlugin.java';
const gradle='android/app/build.gradle';
const manifest='android/app/src/main/AndroidManifest.xml';
if(!existsSync(main)){
 console.log('Android not generated yet; run npm run android:create.');process.exit(0);
}
mkdirSync(path,{recursive:true});copyFileSync('native/android/ShelterBillingPlugin.java',plugin);
let app=readFileSync(main,'utf8');
if(!app.includes('registerPlugin(ShelterBillingPlugin.class)')){
 if(app.includes('public class MainActivity extends BridgeActivity {')){
  app=app.replace('public class MainActivity extends BridgeActivity {', `public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(ShelterBillingPlugin.class);
        super.onCreate(savedInstanceState);
    }
`);
  writeFileSync(main,app);
 }else throw new Error('Cannot patch MainActivity; inspect Android entry point');
}
if(existsSync(gradle)){
 let txt=readFileSync(gradle,'utf8');
 if(!txt.includes('com.android.billingclient:billing:9.1.0')){
  if(!txt.includes('dependencies {'))throw new Error('Cannot locate Gradle dependencies');
  txt=txt.replace('dependencies {',"dependencies {\n    implementation 'com.android.billingclient:billing:9.1.0'");
  writeFileSync(gradle,txt);
 }
}
if(existsSync(manifest)){
 let xml=readFileSync(manifest,'utf8');
 if(!xml.includes('com.android.vending.BILLING')){
  xml=xml.replace('<application', '<uses-permission android:name="com.android.vending.BILLING" />\n    <application');
  writeFileSync(manifest,xml);
 }
}
console.log('Google Play Billing 9.1 adapter installed in generated Android app.');
