import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;

import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Sign an aligned APK with Android v1, v2, and v3 signature schemes. */
public final class SignApk {
    private SignApk() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 6) {
            throw new IllegalArgumentException(
                "Usage: SignApk <input.apk> <output.apk> <keystore> <alias> <store-password> <key-password>"
            );
        }
        File input = new File(args[0]);
        File output = new File(args[1]);
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (FileInputStream stream = new FileInputStream(args[2])) {
            store.load(stream, args[4].toCharArray());
        }
        PrivateKey key = (PrivateKey) store.getKey(args[3], args[5].toCharArray());
        Certificate[] chain = store.getCertificateChain(args[3]);
        if (key == null || chain == null || chain.length == 0) {
            throw new IllegalArgumentException("Signing key or certificate chain was not found");
        }
        List<X509Certificate> certificates = new ArrayList<>();
        for (Certificate certificate : chain) certificates.add((X509Certificate) certificate);

        ApkSigner.SignerConfig config = new ApkSigner.SignerConfig.Builder("CERT", key, certificates).build();
        new ApkSigner.Builder(Collections.singletonList(config))
            .setInputApk(input)
            .setOutputApk(output)
            .setMinSdkVersion(23)
            .setV1SigningEnabled(true)
            .setV2SigningEnabled(true)
            .setV3SigningEnabled(true)
            .setAlignmentPreserved(true)
            .build()
            .sign();

        ApkVerifier.Result result = new ApkVerifier.Builder(output).build().verify();
        if (!result.isVerified() || !result.isVerifiedUsingV2Scheme()) {
            throw new IllegalStateException("APK signature verification failed");
        }
        System.out.printf(
            "Signed %s (v1=%s, v2=%s, v3=%s)%n",
            output, result.isVerifiedUsingV1Scheme(), result.isVerifiedUsingV2Scheme(), result.isVerifiedUsingV3Scheme()
        );
    }
}
