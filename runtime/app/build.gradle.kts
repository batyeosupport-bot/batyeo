plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.batyeo.runtime"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.batyeo.runtime"
        minSdk = 26 // Stripe Terminal SDK requires API 26+ (Android 8.0)
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // Keystore-backed storage for the runtime credential (KioskSettings).
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    // BBPOS WisePOS reader control (org.json is already on the classpath via android.jar).
    implementation("com.stripe:stripeterminal-core:5.8.1")
}
