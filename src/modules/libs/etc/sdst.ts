export {
    SdstSignRequestObject, SdstSignRequest, SdstSignature, VerifiedSdstSignRequest, VerifiedSdstSignature,
    Bytes, InvalidSignedPlainTextError, PublicKeyMissingError,
    plainTextToJsonSignRequest, verifyEd25519JsonSignRequest, keyId, isKeyId,
    canonicalJsonStringify, canonicalHash, isSignRequest, equivalentJsonValue,
    base64ToBytes, base64FromBytes, stringToUtf8Bytes, concatUint8Arrays,
    saltedHash
}

//#region types
type SdstSignRequestObject = {
    "contextId": string,
    "callback": string,
    "signData": string | Object,
    "acceptedAlgorithms"?: string[],
    "acceptedDigestMethods"?: string[],
    "requirePublicKey"?: boolean
}

type SdstSignRequest = {
    data: string | Object,
    signatures: SdstSignature[]
}

type SdstSignature = {
    signature: string,
    keyId?: string,
    publicKey?: string,
    digestMethod?: string
}

type VerifiedSdstSignRequest = {
    data: string | Object,
    signatures: VerifiedSdstSignature[]
}

type VerifiedSdstSignature = {
    signature: string,
    publicKey?: string,
    isValid: boolean
    verifyErr?: Error
}

type Bytes = number[] | Uint8Array | string
//#endregion

const pemStartToken = "-----BEGIN PUBLIC KEY-----"
const pemEndToken = "-----END PUBLIC KEY-----"
const endingPhrases = ["-----SIGNATURE-----", "---SIG---"]


async function saltedHash(val: string, salt: string) {
    return base64FromBytes(await sha256(val + salt))
}

async function canonicalHash(data: any) {
    return toHexString(await sha256(canonicalJsonStringify(data)))
}

//#region sign request
function isSignRequest(x: any): boolean {
    const isSignatureObject = (x: any) =>
        typeof x == "object" && x !== null
        && typeof (x.signature) == "string"
        && typeof (x.publicKey) == "string"

    return typeof x == "object" && x !== null
        && ["string", "object"].includes(typeof x.data)
        && x.data !== null
        && Array.isArray(x.signatures)
        && !x.signatures.some((y: any) => !isSignatureObject(y))
}

async function verifyEd25519JsonSignRequest(sr: SdstSignRequest): Promise<VerifiedSdstSignRequest> {
    const inputBytes = typeof sr.data === "string" ?
        stringToUtf8Bytes(sr.data) : stringToUtf8Bytes(canonicalJsonStringify(sr.data))

    const vsr: VerifiedSdstSignRequest = {
        data: sr.data,
        signatures: []
    }

    for (const so of sr.signatures) {
        const vso: VerifiedSdstSignature = {
            signature: so.signature,
            publicKey: so.publicKey,
            isValid: false
        }

        if (so.publicKey === undefined) {
            vso.verifyErr = new PublicKeyMissingError()
            vsr.signatures.push(vso)
            continue
        }

        try {
            vso.isValid = await verifyEd25519(so.publicKey, base64ToBytes(so.signature), inputBytes)
        } catch (e) {
            vso.verifyErr = e as Error
        } finally {
            vsr.signatures.push(vso)
        }
    }

    return vsr
}

async function verifyEd25519(rawPublicKey: string, signature: Bytes, message: Bytes) {
    const ua = castToUint8Array(message)
    const key = base64ToBytes(rawPublicKey).slice(-32)
    const publicKey = await crypto.subtle.importKey("raw", key, { name: "Ed25519" }, false, ["verify"])
    return await crypto.subtle.verify({ name: "Ed25519" }, publicKey, castToUint8Array(signature), castToUint8Array(message))
}

function plainTextToJsonSignRequest(text: string, requiresPublicKey?: boolean): SdstSignRequest {
    const tr = (x: string) => x.trim()
    const rnl = (x: string) => x.replaceAll("\n", "")

    if (requiresPublicKey == undefined) requiresPublicKey = false

    const lines = text.split("\n")
    const splitAt = lines.findLastIndex((x: string) => endingPhrases.map(tr).includes(tr(x)))
    if (splitAt === -1) throw new InvalidSignedPlainTextError(text, "no ending phrase")
    const data = lines.slice(0, splitAt).join("\n")

    const sig = lines.slice(splitAt + 1).map(tr).join("\n").split("\n\n").map(tr).filter(x => x !== "").map(rnl)
    if (sig.length < 2) throw new InvalidSignedPlainTextError(text, "no name")
    let sigObj: SdstSignature = {
        "signature": sig[0],
        "keyId": undefined,
        "publicKey": undefined,
        "digestMethod": undefined
    }

    if (sig[1].length === 43) {
        sigObj.keyId = sig[1]
    } else if (sig[1].length >= 12 && sig[1].length <= 14) {
        //KeyId prefix (between 12 and 14 characters)
        sigObj.keyId = sig[1]
    } else {
        sigObj.publicKey = rnl(sig[1])
    }

    if (sig.length > 2) {
        sigObj.digestMethod = sig[2]
    }

    if (requiresPublicKey && sigObj.publicKey == undefined)
        throw new PublicKeyMissingError()

    return {
        data: data,
        signatures: [sigObj]
    }
}
//#endregion

//#region public key
async function keyId(publicKey: string) {
    let rawPubKey = publicKeyToRaw(normalizePublicKey(publicKey))
    return base64ToUrlSafe(base64FromBytes(await sha256(base64ToBytes(rawPubKey))))
}

function publicKeyToRaw(publicKeyPem: string) {
    const pk = stringFromUtf8Bytes(castToUint8Array(publicKeyPem))
    return pk.trim().split("\n").slice(1, -1).join("")
}

function publicKeyToPem(publicKeyRaw: string) {
    const lineBreakAfter64 = (x: string) => insertAfterEveryNChars(x, "\n", 64)
    publicKeyRaw = publicKeyRaw.replaceAll("\n", "")
    return pemStartToken + "\n"
        + lineBreakAfter64(base64ToStandard(publicKeyRaw.trim()))
        + "\n" + pemEndToken + "\n"
}

function publicKeyIsPem(publicKey: string) {
    return publicKey.trim().startsWith(pemStartToken)
}

/**
 * @returns `publicKey` in PEM format with trailing newline
 */
function normalizePublicKey(publicKey: string) {
    if (publicKeyIsPem(publicKey)) {
        return publicKey.trim() + "\n" //ensure trailing "\n"
    } else {
        return publicKeyToPem(publicKey)
    }
}

function isKeyId(str: string) {
    return str.match(/^[a-zA-Z0-9\-\_]{43}$/) != null
}
//#endregion

//#region base64
/**
 * Converts standard base64 variant to url-safe one 
 */
function base64ToUrlSafe(base64String: string) {
    return base64String.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 
 * Converts url-safe base64 variant to standard one. If the
 * string is already in standard format then it is returned
 * unmodified.
 */
function base64ToStandard(urlSafeBase64String: string) {
    let x = urlSafeBase64String.replace(/\-/g, '+').replace(/_/g, '/')
    if (x.length % 4 == 2) {
        x += "=="
    } else if (x.length % 4 == 3) {
        x += "="
    }
    return x
}

/**
 * Converts standard base64 and url-safe variant to bytes
 */
function base64ToBytes(base64String: string) {
    let x = base64ToStandard(base64String)
    return castToUint8Array(atob(x).split("").map(x => x.charCodeAt(0)))

}

function base64FromBytes(bytes: Bytes) {
    const ua = castToUint8Array(bytes)
    return btoa(String.fromCodePoint(...ua))
}
//#endregion

//#region bytes
function castToUint8Array(bytes: Bytes): Uint8Array<ArrayBuffer> {
    if (Array.isArray(bytes)) {
        //values outside [0.255] are taken modulo 256
        return new Uint8Array(bytes)
    } else if (bytes instanceof Uint8Array) {
        return bytes as Uint8Array<ArrayBuffer>
    } else if (typeof bytes === "string") {
        return stringToUtf8Bytes(bytes)
    } else {
        throw new TypeError("variable bytes is not string, number[] or Uint8Array")
    }
}

function stringToUtf8Bytes(str: string): Uint8Array<ArrayBuffer> {
    return (new TextEncoder()).encode(str) as Uint8Array<ArrayBuffer>
}

/**
 * Throws an error if bytes are not a valid utf8 sequence
 */
function stringFromUtf8Bytes(bytes: Bytes) {
    let uint8Arr = castToUint8Array(bytes)
    return (new TextDecoder("utf-8", { "fatal": true })).decode(uint8Arr)
}

function concatUint8Arrays(uint8Arr1: Uint8Array, uint8Arr2: Uint8Array) {
    let res = new Uint8Array(uint8Arr1.length + uint8Arr2.length)
    res.set(uint8Arr1)
    res.set(uint8Arr2, uint8Arr1.length)
    return res
}

async function sha256(bytes: Bytes) {
    const uint8Array = castToUint8Array(bytes)
    const hashBuffer = await crypto.subtle.digest("SHA-256", uint8Array)
    return new Uint8Array(hashBuffer)
}

function toHexString(bytes: Bytes) {
    const ua = castToUint8Array(bytes)
    return Array.from(ua, byte => ('0' + byte.toString(16)).slice(-2)).join('')
}
//#endregion

//#region etc
function equivalentJsonValue(a: any, b: any) {
    return canonicalJsonStringify(a) == canonicalJsonStringify(b)
}

function canonicalJsonStringify(obj: any) {
    const sortObjectPropertiesRecursively: any = function (obj: any) {
        if (typeof obj !== "object" || obj === null) return obj
        if (obj.toJSON !== undefined) return sortObjectPropertiesRecursively(obj.toJSON())
        if (Array.isArray(obj)) return obj.map(sortObjectPropertiesRecursively)

        return Object.keys(obj).sort().reduce(function (res: any, key) {
            res[key] = sortObjectPropertiesRecursively(obj[key])
            return res
        }, {})
    }

    return JSON.stringify(sortObjectPropertiesRecursively(obj))
}

/**
 * inserts y into x after every n characters (except at the end)
 * e.g. insertAfterEveryNChars("FFAA33",":",2) = "FF:AA:33"
 */
function insertAfterEveryNChars(x: string, y: string, n: number) {
    let res = ""
    while (x !== "") {
        res += x.slice(0, n) + (x.length > n ? y : "")
        x = x.slice(n)
    }
    return res
}
//#endregion

//#region errors
class InvalidSignedPlainTextError extends Error {
    readonly text: string
    readonly reason: string

    constructor(text: string, reason: string) {
        super("Invalid signed plain text: " + reason)
        this.name = 'InvalidSignedPlainTextError'
        this.text = text
        this.reason = reason
    }
}

class PublicKeyMissingError extends Error {
    constructor() {
        super("Public key missing but required")
        this.name = 'PublicKeyMissingError'

    }
}
//#endregion