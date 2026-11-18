package expo.modules.sharecrypto

import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.SecureRandom

class ShareCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ShareCrypto")
    AsyncFunction("encrypt") { plaintext: String, keyBase64: String, aad: String ->
      val keyBytes = Base64.decode(keyBase64, Base64.NO_WRAP)
      val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
      val ciphertext = AesGcmCipher.encrypt(plaintext.toByteArray(Charsets.UTF_8), keyBytes, iv, aad.toByteArray(Charsets.UTF_8))
      mapOf("iv" to Base64.encodeToString(iv, Base64.NO_WRAP), "ciphertext" to Base64.encodeToString(ciphertext, Base64.NO_WRAP))
    }
    AsyncFunction("decrypt") { ciphertext: String, iv: String, keyBase64: String, aad: String ->
      val keyBytes = Base64.decode(keyBase64, Base64.NO_WRAP)
      String(AesGcmCipher.decrypt(Base64.decode(ciphertext, Base64.NO_WRAP), keyBytes, Base64.decode(iv, Base64.NO_WRAP), aad.toByteArray(Charsets.UTF_8)), Charsets.UTF_8)
    }
    AsyncFunction("deriveVaultKey") { passphrase: String, deviceSecretBase64: String, saltBase64: String, namespace: String ->
      VaultKeyDerivation.derive(passphrase, deviceSecretBase64, saltBase64, namespace)
    }
  }
}
