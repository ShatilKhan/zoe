package expo.modules.sharecrypto

import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Test

class AesGcmCipherTest {
  @Test fun `matches browser WebCrypto interoperability vector`() {
    val key = ByteArray(32) { it.toByte() }
    val iv = ByteArray(12) { (it + 32).toByte() }
    val aad = "{\"version\":1,\"keyId\":\"interop-key\",\"patientId\":\"patient-a\",\"recipientId\":\"clinician-a\",\"objectId\":\"object-a\",\"expiresAt\":\"2099-01-01T00:00:00.000Z\"}"
    val plaintext = "{\"patientDisplayName\":\"Synthetic Patient\",\"createdAt\":\"2026-11-18T00:00:00.000Z\",\"records\":[]}"
    val encrypted = AesGcmCipher.encrypt(plaintext.toByteArray(), key, iv, aad.toByteArray())
    assertEquals("qRjWERjxf2BuOCu9sXSVgJ4ogfmlukG9FZgYeiz+N2pV3oRw50BbrjbRTPEqbH68h06t+rgGD1P+UEkwfYMn7OBy/Tusp9Wsu1rHF4ttY0P5tUFh1JT0erxt+HFHYdjyqvyGQFKjAwslAL4mB/c=", Base64.getEncoder().encodeToString(encrypted))
    assertEquals(plaintext, String(AesGcmCipher.decrypt(encrypted, key, iv, aad.toByteArray())))
  }
}
