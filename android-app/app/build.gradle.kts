plugins {
    id("com.android.application")
}

android {
    namespace = "com.inori.hdquizstudy"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.inori.hdquizstudy"
        minSdk = 23
        targetSdk = 35
        versionCode = 10900
        versionName = "1.9.0"
    }

    sourceSets {
        getByName("main") {
            java.srcDir("../../native-src")
            assets.srcDir("../../app")
        }
    }
}
