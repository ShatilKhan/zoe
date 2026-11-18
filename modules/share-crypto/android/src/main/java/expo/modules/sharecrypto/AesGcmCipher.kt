package expo.modules.sharecrypto

import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

object AesGcmCipher {
  fun encrypt(plaintext: ByteArray, key: ByteArray, iv: ByteArray, aad: ByteArray): ByteArray {
    require(key.size == 32) { "AES-256 key must contain 32 bytes" }
    require(iv.size == 12) { "AES-GCM IV must contain 12 bytes" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
    cipher.updateAAD(aad)
    return cipher.doFinal(plaintext)
  }

  fun decrypt(ciphertext: ByteArray, key: ByteArray, iv: ByteArray, aad: ByteArray): ByteArray {
    require(key.size == 32) { "AES-256 key must contain 32 bytes" }
    require(iv.size == 12) { "AES-GCM IV must contain 12 bytes" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
    cipher.updateAAD(aad)
    return cipher.doFinal(ciphertext)
  }
}
