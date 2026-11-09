import java.net.URI

plugins {
    id("com.android.application")
    id("com.google.gms.google-services")
    id("org.jetbrains.kotlin.android")
}

fun attendanceApiUrl(): String {
    // An empty property/environment variable must not erase the hosted default.
    val url = sequenceOf(providers.gradleProperty("ATTENDANCE_API_URL").orNull,
        providers.environmentVariable("ATTENDANCE_API_URL").orNull,
        "https://placement-tracker-lyjf.onrender.com/api")
        .first { !it.isNullOrBlank() }!!.trim().trimEnd('/')
    val uri = URI(url)
    val localDebugHost = uri.scheme == "http" && uri.host in setOf("localhost", "127.0.0.1", "10.0.2.2")
    require((uri.scheme == "https" || localDebugHost) && uri.host != null && uri.userInfo == null && uri.query == null && uri.fragment == null) {
        "ATTENDANCE_API_URL must be an HTTPS API address (HTTP is allowed only for a local debug host)."
    }
    return url
}
fun literal(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "") + "\""

android {
    namespace = "in.shikshavertex.attendance"
    compileSdk = 35
    buildToolsVersion = "35.0.0"
    defaultConfig {
        applicationId = "in.shikshavertex.attendance"
        minSdk = 28
        targetSdk = 35
        versionCode = 10
        versionName = "1.9"
        buildConfigField("String", "API_BASE_URL", literal(attendanceApiUrl()))
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildTypes {
        release {
            isMinifyEnabled = false
            // Configure a private release signing key in Android Studio; never commit it.
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.fragment:fragment-ktx:1.8.5")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.firebase:firebase-auth:23.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
    testImplementation("junit:junit:4.13.2")
}
