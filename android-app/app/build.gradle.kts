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
        versionCode = 10602
        versionName = "1.6.2"
    }

    sourceSets {
        getByName("main") {
            java.srcDir("../../native-src")
            assets.srcDir("../../app")
        }
    }
}
