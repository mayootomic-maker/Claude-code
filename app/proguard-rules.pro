-keepattributes *Annotation*, InnerClasses, Signature, RuntimeVisible*Annotations
# kotlinx-serialization
-keepclassmembers class ** { *** Companion; }
-keepclasseswithmembers class ** { kotlinx.serialization.KSerializer serializer(...); }
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
    static ** serializer(...);
}
-dontwarn kotlinx.serialization.**
