import { requireNativeModule } from "expo";

interface ShareCryptoNativeModule {
  deriveVaultKey(passphrase: string, deviceSecretBase64: string, saltBase64: string, namespace: string): Promise<string>;
}
export default requireNativeModule<ShareCryptoNativeModule>("ShareCrypto");
