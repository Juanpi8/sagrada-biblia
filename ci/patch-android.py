"""Applies the native voice engine to the Capacitor-generated Android project (run after `npx cap add android`)."""
import os, re, shutil, sys, zipfile, glob
A = 'android'
pkg = 'uy/juanpi/sagradabiblia'
src_dir = f'{A}/app/src/main/java/{pkg}'
os.makedirs(src_dir, exist_ok=True)
shutil.copy('native/android/PiperNativePlugin.kt', src_dir)
# Register the plugin
main = f'{src_dir}/MainActivity.java'
open(main, 'w').write('''package uy.juanpi.sagradabiblia;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PiperNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
''')
# Kotlin Gradle plugin
root = f'{A}/build.gradle'; s = open(root).read()
if 'kotlin-gradle-plugin' not in s:
    s = re.sub(r"(classpath ['\"]com\.android\.tools\.build:gradle:[^'\"]+['\"])", r"\1\n        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:2.0.21'", s, count=1)
open(root, 'w').write(s)
app = f'{A}/app/build.gradle'; s = open(app).read()
if "kotlin-android" not in s:
    s = s.replace("apply plugin: 'com.android.application'", "apply plugin: 'com.android.application'\napply plugin: 'kotlin-android'", 1)
s = re.sub(r"defaultConfig\s*\{", "defaultConfig {\n        ndk { abiFilters 'arm64-v8a', 'armeabi-v7a' }", s, count=1)
s = re.sub(r"android\s*\{", "android {\n    kotlinOptions { jvmTarget = '21' }\n    packagingOptions { jniLibs { useLegacyPackaging = true } }", s, count=1)
deps = """
    implementation files('libs/sherpa-onnx.aar')
    implementation 'org.jetbrains.kotlin:kotlin-stdlib:2.0.21'
    implementation 'org.apache.commons:commons-compress:1.27.1'
"""
s = re.sub(r"dependencies\s*\{", "dependencies {" + deps, s, count=1)
open(app, 'w').write(s)
# If the AAR does not ship the Kotlin API classes, add the official Tts.kt source next to our plugin.
aar = f'{A}/app/libs/sherpa-onnx.aar'
z = zipfile.ZipFile(aar)
has = False
if 'classes.jar' in z.namelist():
    import io
    cj = zipfile.ZipFile(io.BytesIO(z.read('classes.jar')))
    has = any(n.endswith('com/k2fsa/sherpa/onnx/OfflineTts.class') for n in cj.namelist())
print('AAR contains Kotlin TTS API:', has)
print('AAR native libs:', [n for n in z.namelist() if n.endswith('.so')][:8])
if not has:
    kt = 'Tts.kt'
    if not os.path.exists(kt): sys.exit('AAR has no OfflineTts class and Tts.kt was not downloaded')
    d = f'{A}/app/src/main/java/com/k2fsa/sherpa/onnx'; os.makedirs(d, exist_ok=True); shutil.copy(kt, d)
print(open(app).read())
# The in-page (WASM) voice runtime is not needed in the Android app: the native engine replaces it.
for f in glob.glob(f'{A}/app/src/main/assets/public/tts/*'):
    if not f.endswith('piper.js'): os.remove(f)
