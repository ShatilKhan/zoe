import { requireNativeModule } from "expo";

export interface NativeCiphertext { iv: string; ciphertext: string; }
interface ShareCryptoNativeModule {
  encrypt(plaintext: string, keyBase64: string, aad: string): Promise<NativeCiphertext>;
  decrypt(ciphertext: string, iv: string, keyBase64: string, aad: string): Promise<string>;
  deriveVaultKey(passphrase: string, deviceSecretBase64: string, saltBase64: string, namespace: string): Promise<string>;
}
export default requireNativeModule<ShareCryptoNativeModule>("ShareCrypto");
