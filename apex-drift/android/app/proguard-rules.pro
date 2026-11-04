# Bridge methods are only ever called from JavaScript by name, so R8 sees no
# callers and would strip or rename them.
-keepattributes JavascriptInterface
-keepclassmembers class com.tomicstudios.apexdrift.ApexBridge {
    @android.webkit.JavascriptInterface <methods>;
}
