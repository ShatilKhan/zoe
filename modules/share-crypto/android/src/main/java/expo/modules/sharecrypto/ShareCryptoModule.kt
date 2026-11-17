package expo.modules.sharecrypto

import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class ShareCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ShareCrypto")
    AsyncFunction("encrypt") { plaintext: String, keyBase64: String, aad: String ->
      val keyBytes = Base64.decode(keyBase64, Base64.NO_WRAP)
      require(keyBytes.size == 32) { "AES-256 key must contain 32 bytes" }
      val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(keyBytes, "AES"), GCMParameterSpec(128, iv))
      cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
      val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
      mapOf("iv" to Base64.encodeToString(iv, Base64.NO_WRAP), "ciphertext" to Base64.encodeToString(ciphertext, Base64.NO_WRAP))
    }
    AsyncFunction("decrypt") { ciphertext: String, iv: String, keyBase64: String, aad: String ->
      val keyBytes = Base64.decode(keyBase64, Base64.NO_WRAP)
      require(keyBytes.size == 32) { "AES-256 key must contain 32 bytes" }
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(keyBytes, "AES"), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
      cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
      String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), Charsets.UTF_8)
    }
  }
}
