package expo.modules.sharecrypto

import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class VaultKeyDerivationTest {
  @Test fun `PBKDF2 SHA256 matches known vector`() {
    val actual = VaultKeyDerivation.pbkdf2Sha256("password".toCharArray(), "salt".toByteArray(), 1, 32)
    assertEquals("120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b", actual.hex())
  }

  @Test fun `KDF is versioned deterministic and account bound`() {
    assertEquals(1, VaultKeyDerivation.VERSION)
    val secret = Base64.getEncoder().encodeToString(ByteArray(32) { it.toByte() })
    val salt = Base64.getEncoder().encodeToString(ByteArray(16) { (it + 32).toByte() })
    val first = VaultKeyDerivation.derive("Correct Horse Battery Staple! 47", secret, salt, "account-a:passphrase")
    assertEquals("3d55c6a10c8c6302f3b8c907178f6c33b7a30d0c1846792f4c393934e624d4f7", first)
    assertEquals(first, VaultKeyDerivation.derive("Correct Horse Battery Staple! 47", secret, salt, "account-a:passphrase"))
    assertNotEquals(first, VaultKeyDerivation.derive("Wrong Horse Battery Staple! 47", secret, salt, "account-a:passphrase"))
    assertNotEquals(first, VaultKeyDerivation.derive("Correct Horse Battery Staple! 47", secret, salt, "account-b:passphrase"))
  }

  private fun ByteArray.hex() = joinToString("") { "%02x".format(it.toInt() and 0xff) }
}
