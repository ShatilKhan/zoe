package expo.modules.sharecrypto

import java.util.Base64
import java.text.Normalizer
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

object VaultKeyDerivation {
  const val VERSION = 1
  const val PBKDF2_ITERATIONS = 210_000
  private const val DOMAIN = "zoe-vault-kdf-v1"

  fun pbkdf2Sha256(password: CharArray, salt: ByteArray, iterations: Int, outputBytes: Int): ByteArray {
    require(iterations > 0 && outputBytes > 0)
    val spec = PBEKeySpec(password, salt, iterations, outputBytes * 8)
    return try {
      SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
    } finally {
      spec.clearPassword()
    }
  }

  fun derive(passphrase: String, deviceSecretBase64: String, saltBase64: String, namespace: String): String {
    require(passphrase.isNotEmpty()) { "Passphrase is required" }
    require(namespace.matches(Regex("^[A-Za-z0-9_-]{3,80}:passphrase$"))) { "Vault namespace is invalid" }
    var deviceSecret: ByteArray? = null
    var salt: ByteArray? = null
    var password: CharArray? = null
    var stretched: ByteArray? = null
    return try {
      val decodedSecret = Base64.getDecoder().decode(deviceSecretBase64)
      deviceSecret = decodedSecret
      val decodedSalt = Base64.getDecoder().decode(saltBase64)
      salt = decodedSalt
      require(decodedSecret.size == 32) { "Device secret must contain 32 bytes" }
      require(decodedSalt.size == 16) { "Vault salt must contain 16 bytes" }
      val normalizedPassword = Normalizer.normalize(passphrase, Normalizer.Form.NFKC).toCharArray()
      password = normalizedPassword
      val derivedPassword = pbkdf2Sha256(normalizedPassword, decodedSalt, PBKDF2_ITERATIONS, 32)
      stretched = derivedPassword
      val mac = Mac.getInstance("HmacSHA256")
      mac.init(SecretKeySpec(decodedSecret, "HmacSHA256"))
      mac.update(DOMAIN.toByteArray(Charsets.UTF_8))
      mac.update(0.toByte())
      mac.update(namespace.toByteArray(Charsets.UTF_8))
      mac.update(0.toByte())
      mac.doFinal(derivedPassword).joinToString("") { "%02x".format(it.toInt() and 0xff) }
    } finally {
      password?.fill('\u0000')
      stretched?.fill(0)
      deviceSecret?.fill(0)
      salt?.fill(0)
    }
  }
}
