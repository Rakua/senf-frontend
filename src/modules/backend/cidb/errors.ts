export { KeyCisError, UnknownKeyIdError }

class KeyCisError extends Error {
    readonly err: Error

    constructor(err: Error) {
        super(`Failed to get key CIs: ${err.message}`)
        this.name = 'KeyCisError'
        this.err = err
    }
}

class UnknownKeyIdError extends Error {
    readonly keyId: string

    constructor(keyId: string) {
        super(`KeyId ${keyId} is not a platform signing key`)
        this.name = 'UnknownKeyIdError'
        this.keyId = keyId
    }
}