import Foundation
import CryptoKit

// MARK: - ECDHError

/// Errors that can occur during ECDH key exchange and encryption operations.
enum ECDHError: LocalizedError {
    case invalidPeerPublicKey
    case encryptionFailed(Error)
    case decryptionFailed(Error)
    case sealedBoxCorrupted
    case keyDerivationFailed

    var errorDescription: String? {
        switch self {
        case .invalidPeerPublicKey:
            return "Invalid peer public key data"
        case .encryptionFailed(let error):
            return "Encryption failed: \(error.localizedDescription)"
        case .decryptionFailed(let error):
            return "Decryption failed: \(error.localizedDescription)"
        case .sealedBoxCorrupted:
            return "Sealed box data is corrupted or tampered with"
        case .keyDerivationFailed:
            return "Failed to derive symmetric key from shared secret"
        }
    }
}

// MARK: - ECDHManager

/// P-256 ECDH key exchange manager using Apple CryptoKit.
///
/// Handles the full lifecycle of an encrypted session:
/// 1. Generate a local P-256 key pair
/// 2. Exchange public keys with the peer (desktop WOTANN)
/// 3. Derive a shared secret via ECDH
/// 4. Derive a symmetric AES-256-GCM key using HKDF-SHA256
/// 5. Encrypt/decrypt messages with AES-GCM
///
/// Supports key rotation by regenerating the private key.
final class ECDHManager {

    // MARK: - Properties

    private var privateKey: P256.KeyAgreement.PrivateKey
    private var derivedKey: SymmetricKey?

    private static let salt = Data("wotann-v1".utf8)
    private static let keyByteCount = 32

    // MARK: - Init

    init() {
        privateKey = P256.KeyAgreement.PrivateKey()
    }

    // MARK: - Public Key

    /// Raw representation of the local public key for sending to the peer.
    var publicKeyData: Data {
        privateKey.publicKey.rawRepresentation
    }

    // MARK: - Key Agreement

    /// Derive a shared secret from the peer's raw public key data.
    /// - Parameter peerPublicKeyData: The peer's P-256 public key in raw representation.
    /// - Returns: The ECDH shared secret.
    func deriveSharedSecret(peerPublicKeyData: Data) throws -> SharedSecret {
        let peerKey: P256.KeyAgreement.PublicKey
        do {
            peerKey = try P256.KeyAgreement.PublicKey(rawRepresentation: peerPublicKeyData)
        } catch {
            throw ECDHError.invalidPeerPublicKey
        }
        return try privateKey.sharedSecretFromKeyAgreement(with: peerKey)
    }

    /// Derive an AES-256 symmetric key from a shared secret using HKDF-SHA256.
    /// - Parameter secret: The ECDH shared secret.
    /// - Returns: A 256-bit symmetric key suitable for AES-GCM.
    func deriveSymmetricKey(from secret: SharedSecret) -> SymmetricKey {
        secret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Self.salt,
            sharedInfo: Data(),
            outputByteCount: Self.keyByteCount
        )
    }

    /// Complete the key exchange: derive shared secret + symmetric key from peer data.
    /// After calling this, `encrypt` and `decrypt` use the derived key automatically.
    /// - Parameter peerPublicKeyData: The peer's raw public key.
    func completeKeyExchange(peerPublicKeyData: Data) throws {
        let secret = try deriveSharedSecret(peerPublicKeyData: peerPublicKeyData)
        derivedKey = deriveSymmetricKey(from: secret)
    }

    /// Whether a symmetric key has been derived (key exchange completed).
    var isKeyExchangeComplete: Bool {
        derivedKey != nil
    }

    /// Expose the derived symmetric key as raw bytes so callers (e.g. the
    /// main app) can persist it in the shared Keychain for the intent
    /// extension to rehydrate. Returns nil before `completeKeyExchange`.
    var derivedKeyData: Data? {
        guard let key = derivedKey else { return nil }
        return key.withUnsafeBytes { Data($0) }
    }

    /// Rehydrate a previously-persisted symmetric key without running a
    /// new ECDH exchange. Used by the Siri intent extension so intents
    /// can reuse the main app's session key instead of running a 30-second
    /// ECDH negotiation on every invocation (which would be impossible
    /// anyway since the intent extension can't reach the desktop's
    /// peer-public-key endpoint before the intent deadline fires).
    ///
    /// - Parameter keyData: Exactly 32 bytes (256 bits) matching the
    ///   AES-GCM key size. Rejects other lengths so a corrupted
    ///   keychain value can't silently downgrade the cipher strength.
    func loadDerivedKey(_ keyData: Data) throws {
        guard keyData.count == Self.keyByteCount else {
            throw ECDHError.keyDerivationFailed
        }
        derivedKey = SymmetricKey(data: keyData)
    }

    // MARK: - Encryption

    /// Encrypt plaintext data using AES-GCM with the derived symmetric key.
    /// - Parameters:
    ///   - data: The plaintext to encrypt.
    ///   - key: Optional explicit key. If nil, uses the internally derived key.
    /// - Returns: The combined sealed box (nonce + ciphertext + tag).
    func encrypt(_ data: Data, using key: SymmetricKey? = nil) throws -> Data {
        guard let symmetricKey = key ?? derivedKey else {
            throw ECDHError.keyDerivationFailed
        }
        do {
            let sealedBox = try AES.GCM.seal(data, using: symmetricKey)
            guard let combined = sealedBox.combined else {
                throw ECDHError.sealedBoxCorrupted
            }
            return combined
        } catch let error as ECDHError {
            throw error
        } catch {
            throw ECDHError.encryptionFailed(error)
        }
    }

    /// Encrypt a UTF-8 string.
    /// - Parameters:
    ///   - string: The plaintext string.
    ///   - key: Optional explicit key. If nil, uses the internally derived key.
    /// - Returns: The combined sealed box bytes.
    func encrypt(_ string: String, using key: SymmetricKey? = nil) throws -> Data {
        guard let data = string.data(using: .utf8) else {
            throw ECDHError.encryptionFailed(
                NSError(domain: "ECDHManager", code: -1,
                        userInfo: [NSLocalizedDescriptionKey: "String encoding failed"])
            )
        }
        return try encrypt(data, using: key)
    }

    // MARK: - Decryption

    /// Decrypt a combined AES-GCM sealed box back to plaintext data.
    /// - Parameters:
    ///   - combinedData: The sealed box (nonce + ciphertext + tag).
    ///   - key: Optional explicit key. If nil, uses the internally derived key.
    /// - Returns: The decrypted plaintext.
    func decrypt(_ combinedData: Data, using key: SymmetricKey? = nil) throws -> Data {
        guard let symmetricKey = key ?? derivedKey else {
            throw ECDHError.keyDerivationFailed
        }
        do {
            let sealedBox = try AES.GCM.SealedBox(combined: combinedData)
            return try AES.GCM.open(sealedBox, using: symmetricKey)
        } catch let error as ECDHError {
            throw error
        } catch {
            throw ECDHError.decryptionFailed(error)
        }
    }

    /// Decrypt a combined sealed box and return the result as a UTF-8 string.
    /// - Parameters:
    ///   - combinedData: The sealed box bytes.
    ///   - key: Optional explicit key. If nil, uses the internally derived key.
    /// - Returns: The decrypted UTF-8 string.
    func decryptString(_ combinedData: Data, using key: SymmetricKey? = nil) throws -> String {
        let plaintext = try decrypt(combinedData, using: key)
        guard let string = String(data: plaintext, encoding: .utf8) else {
            throw ECDHError.decryptionFailed(
                NSError(domain: "ECDHManager", code: -2,
                        userInfo: [NSLocalizedDescriptionKey: "Decrypted data is not valid UTF-8"])
            )
        }
        return string
    }

    // MARK: - Key Rotation

    /// Rotate the local key pair. Clears the derived symmetric key.
    /// After rotation, `completeKeyExchange` must be called again with the peer's key.
    /// - Returns: The new public key data to send to the peer.
    @discardableResult
    func rotateKeys() -> Data {
        privateKey = P256.KeyAgreement.PrivateKey()
        derivedKey = nil
        return publicKeyData
    }
}
