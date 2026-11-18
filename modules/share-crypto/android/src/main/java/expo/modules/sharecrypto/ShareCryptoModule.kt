package expo.modules.sharecrypto

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ShareCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ShareCrypto")
    AsyncFunction("deriveVaultKey") { passphrase: String, deviceSecretBase64: String, saltBase64: String, namespace: String ->
      VaultKeyDerivation.derive(passphrase, deviceSecretBase64, saltBase64, namespace)
    }
  }
}
