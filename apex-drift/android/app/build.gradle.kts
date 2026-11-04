import javax.inject.Inject

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

/**
 * Copies the web build into the APK's assets under `www/`, which is what the
 * `https://appassets.androidplatform.net/assets/www/` origin of 2.0 maps to.
 * Changing that path would change the origin and orphan every player's save.
 */
abstract class SyncWebAssets @Inject constructor(
    private val fs: FileSystemOperations,
) : DefaultTask() {
    // @InputFiles rather than @InputDirectory so a missing dist reaches the
    // explicit error below instead of a generic validation failure.
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val webDist: DirectoryProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun sync() {
        val dist = webDist.get().asFile
        if (!dist.resolve("index.html").isFile) {
            throw GradleException(
                "Web build not found: ${dist.resolve("index.html")} does not exist.\n" +
                    "Build the game first:  cd apex-drift/web && npm ci && npm run build",
            )
        }
        fs.sync {
            from(dist) { into("www") }
            into(outputDir)
        }
    }
}

val webDistDir: Directory = rootProject.layout.projectDirectory.dir("../web/dist")

// Read from the environment so no credential ever sits in a tracked file.
// Blank counts as absent because CI expands a missing secret to "".
fun env(name: String): String? =
    providers.environmentVariable(name).orNull?.takeIf { it.isNotBlank() }

val releaseKeystore = env("APEX_KEYSTORE")

android {
    namespace = "com.tomicstudios.apexdrift"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.tomicstudios.apexdrift"
        minSdk = 26
        targetSdk = 36
        versionCode = 5
        versionName = "3.0.0"
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = env("APEX_KEYSTORE_PASSWORD")
                keyAlias = env("APEX_KEY_ALIAS")
                keyPassword = env("APEX_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // Unsigned when no keystore is configured, so CI on forks and
            // local builds still produce an .aab/.apk to inspect.
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    androidResources {
        // The default pattern also drops dotfiles and any directory starting
        // with "_", which would silently remove parts of the web build.
        ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:!CVS:!thumbs.db:!picasa.ini:!*~"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

androidComponents {
    onVariants { variant ->
        val sync = tasks.register<SyncWebAssets>(
            "sync${variant.name.replaceFirstChar(Char::titlecase)}WebAssets",
        ) {
            webDist.set(webDistDir)
        }
        // Registering as a generated source directory makes merge*Assets,
        // lint and every other asset consumer depend on the sync task.
        variant.sources.assets?.addGeneratedSourceDirectory(sync, SyncWebAssets::outputDir)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.ktx)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.core.splashscreen)
}
