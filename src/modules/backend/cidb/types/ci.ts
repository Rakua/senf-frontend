export {
    Ci, CiType,
    UserCi, UserCiMetadata, UserCiEcho, UserCiPost,
    PlatformCi, PlatformCiInauguration, PlatformCiKey, PlatformCiLog,
    PlatformKey, UserChain, LogEntry,
    CiUrn, CiId, CiSource, KeyId,
    ciId, ciPrimaryKey, ciPoster, ciMetadata, ciLocation, ciPostTime, ciWaitingTime, ciBody, ciHash, ciType,
    serializeUserCi, normalizeCiTimestamp,
    verifyUserCiShape, toCiUrn, parseCiUrn, platformChain, ciSchemeName, keyIdSchemeName,
    platformCiExample, userCiExample, userCiExampleWithoutContent
}

import { MakeOptional, NestedOmit, toIsoStringWoMs, toJson } from "../../../libs/basic/misc.js"
import { arrayType, customFullTypePredicate, hasType, intersectionType, literalType, optionalType, tupleType, TypeMismatch, unionType } from "../../../libs/etc/guard.js"
import { canonicalHash } from "../../../libs/etc/sdst.js"
import { UserCiPrimaryKey } from "../cidb.js"

const ciSchemeName = "ci"
const keyIdSchemeName = "kid"
const platformName = "senf.in"

enum CiType {
    Inauguration = "platform/inauguration",
    Key = "platform/key",
    Log = "platform/log",
    Post = "user/post",
    Echo = "user/echo",
    Anti = "user/anti"
}
type CiTypePlatform = typeof ciTypePlatformT[number]
type CiTypeUser = typeof ciTypeUserT[number]
const ciTypePlatformT = [CiType.Inauguration, CiType.Key, CiType.Log] as const
const ciTypeUserT = [CiType.Post, CiType.Echo] as const

type Ci = PlatformCi | UserCi
type PlatformCi = PlatformCiInauguration | PlatformCiKey | PlatformCiLog
type UserCi = UserCiPost | UserCiEcho

type UserCiMetadata = {
    data: {
        metadata: MakeOptional<Omit<CiMetadataUser, "previousCi">, "location">
    }
}

type PlatformCiInauguration = CiTmpl<CiType.Inauguration, CiMetadata, InaugurationContent>
type PlatformCiKey = CiTmpl<CiType.Key, CiMetadata, PlatformKey>
type PlatformCiLog = CiTmpl<CiType.Log, CiMetadata, LogEntry[]>

type UserCiPost = CiTmpl<CiType.Post, CiMetadataUser, UserContent>
type UserCiEcho = CiTmpl<CiType.Echo, CiMetadataUser, UserContent>

type UserContent = {
    data: string,
    signatures: [Signature]
}

type InaugurationContent = {
    platformOwner: KeyId,
    platformOwnerRecovationKey: KeyId,
    message: string
}

type PlatformKey = {
    publicKey: string,
    keyId: KeyId,
    validFrom: Date,
    validUntil: Date
}

type LogEntry = {
    hash: string,
    chain: string,
    seqNo: number,
    timestamp: Date,
    type: CiType,
    payment: CiPayment,
    scheme: string,
    location: SaltedHash,
    keyId?: SaltedHash, //undefined => anon post
}

type CiTmpl<Type extends CiType, Metadata extends CiMetadata | CiMetadataUser, Content> = {
    data: {
        metadata: Metadata
        content: Content
    },
    signatures: [{
        signature: string,
        keyId: KeyId
    }]
} & { data: { metadata: { type: Type } } }

type CiMetadata = {
    platform: string,
    chain: string,
    seqNo: number,
    timestamp: Date,
    type: CiType,
    previousCi?: Hash //defined if seqNo > 1    
}

type CiMetadataUser = CiMetadata & {
    payment: CiPayment
    location: string
}

type KeyId = string
type Signature = {
    signature: string,
    publicKey: string,
    keyId: KeyId
}

type UserChain = string
type Hash = string
type SaltedHash = { hash: Hash, salt: string }

type CiPayment = {
    amount: number,
    unit: string
}

type CiId = { platform?: string, chain: string, seqNo: number }
type CiUrn = `ci:${number}@${string}.${string}` // ci-id @ chain . platform

type CiSource = CiSourceFile | CiSourceUrl | CiSourcePost

type CiSourceFile = {
    type: "file",
    filename: string
}

type CiSourceUrl = {
    type: "url",
    url: string,
    archiveUrl?: string
}

type CiSourcePost = {
    type: "post"
}

//#region helper functions

/**
 * Converts user chain to corresponding platform chain
 */
function platformChain(chain: UserChain) {
    return "p" + chain
}


function toCiUrn(cid: CiId | UserCiPrimaryKey): CiUrn {
    if (Array.isArray(cid)) cid = { chain: cid[0], seqNo: cid[1] }
    cid.platform ??= platformName
    return `ci:${cid.seqNo}@${cid.chain}.${cid.platform}`
}

function parseCiUrn(uri: string): CiId | null {
    const re = /ci:([1-9][0-9]*)@([a-z0-9]*)((\.[a-z0-9]+)+)/
    const res = re.exec(uri)
    if (res == null) return null

    return {
        platform: res[3].slice(1),
        chain: res[2],
        seqNo: Number(res[1])
    }
}

function ciId(ci: Ci | UserCiMetadata): CiId {
    const md = ciMetadata(ci as UserCi)
    return {
        platform: md.platform,
        chain: md.chain,
        seqNo: md.seqNo
    }
}

function ciPrimaryKey(ci: Ci | UserCiMetadata): [string, number] {
    const cid = ciId(ci)
    return [cid.chain, cid.seqNo]
}

function ciPostTime(ci: Ci | UserCiMetadata) {
    return ciMetadata(ci as UserCi).timestamp
}

/**
 * Use this to reference the metadata field
 */
function ciMetadata(ci: UserCi | UserCiMetadata): UserCi["data"]["metadata"];
function ciMetadata(ci: PlatformCi): PlatformCi["data"]["metadata"];
function ciMetadata(ci: Ci): PlatformCi["data"]["metadata"];
function ciMetadata(ci: Ci | UserCiMetadata) {
    return ci.data.metadata
}

/**
 * @returns null if unsigned post
 */
function ciPoster(ci: UserCi): KeyId | null {
    const s = ci.data.content.signatures
    if (!Array.isArray(s) || (s.length as any) == 0) return null
    return s[0].keyId
}

function ciLocation(ci: UserCi): string {
    return ciMetadata(ci).location
}

function ciWaitingTime(ci: UserCi | UserCiMetadata) {
    const p = ciMetadata(ci).payment
    if (p.unit != "min") return 0
    return p.amount
}

function ciType(ci: UserCi | UserCiMetadata) {
    return ciMetadata(ci).type
}

function ciBody(ci: UserCiPost) {
    return ci.data.content.data.split("\n").slice(2).join("\n")
}

async function ciHash(ci: Ci) {
    const ciMd = ciMetadata(ci)
    //convert Date object back to ISO string without ms for correct hash
    if (ciMd.timestamp instanceof Date)
        ciMd.timestamp = toIsoStringWoMs(ciMetadata(ci).timestamp) as any

    return await canonicalHash(ci)
}

/**
 * Serializes a user CI by removing the ms part of the ISO timestamp and 
 * then applying `toJson`.
 */
function serializeUserCi(ci: UserCi) {
    //return toJson(normalizeCiTimestamp(ci))
    return toJson(ci)
}

/**
 * Converts the timestamp in metadata back to an ISO string without the ms part.
 */
function normalizeCiTimestamp(ci: UserCi) {
    const ci0 = structuredClone(ci)
    const ci0Md = ciMetadata(ci0)
    //use ISO date string without ms part since this is how it has been issued by the backend
    ci0Md.timestamp = toIsoStringWoMs(ciMetadata(ci).timestamp) as any
    return ci0
}

//#endregion

//todo: clean up types as values

//#region old types as values for guards

//tuple type => single signature
const platformSignaturEx = tupleType(unionType(
    { signature: "", keyId: "" },
    { signature: "", publicKey: "" }
))

const commonCiStructureEx = {
    data: {
        metadata: {
            platform: "",
            chain: "",
            seqNo: 0,
            timestamp: new Date(),
            previousCi: optionalType("")
        }
    },
    signatures: platformSignaturEx
}

const commonPlatformCiStructure = intersectionType(commonCiStructureEx, {
    data: {
        metadata: {
            type: literalType(...ciTypePlatformT)
        }
    }
})

const commonUserCiStructure = intersectionType(commonCiStructureEx, {
    data: {
        metadata: {
            type: literalType(...ciTypeUserT),
            payment: {
                amount: 0,
                unit: ""
            },
            location: ""
        }
    }
})

const commonUserCiStructureLocationOptional = intersectionType(commonCiStructureEx, {
    data: {
        metadata: {
            type: literalType(...ciTypeUserT),
            payment: {
                amount: 0,
                unit: ""
            },
            location: optionalType("")
        }
    }
})

const userCiContentEx = {
    data: "",
    signatures: arrayType({
        signature: "",
        publicKey: "",
        keyId: ""
    }, { maxLength: 1 })
}

const ciContentEx = {
    [CiType.Inauguration]: {
        struc: commonPlatformCiStructure,
        content: {
            operator: "",
            operatorRecovationKey: "",
            message: ""
        }
    },
    [CiType.Key]: {
        struc: commonPlatformCiStructure,
        content: {
            publicKey: "",
            keyId: "",
            validFrom: new Date(),
            validUntil: new Date()
        }
    },
    [CiType.Log]: {
        struc: commonPlatformCiStructure,
        content: [{
            hash: "",
            chain: "",
            seqNo: 0,
            timestamp: new Date(),
            type: literalType(...ciTypeUserT),
            payment: {
                amount: 0,
                unit: ""
            },
            location: {
                hash: "",
                salt: ""
            },
            scheme: ""
        }]
    },
    [CiType.Post]: {
        struc: commonUserCiStructure,
        strucLocationOptional: commonUserCiStructureLocationOptional,
        content: userCiContentEx,
    },
    [CiType.Echo]: {
        struc: commonUserCiStructure,
        strucLocationOptional: commonUserCiStructureLocationOptional,
        content: userCiContentEx,
    },
    [CiType.Anti]: {
        struc: commonUserCiStructure,
        strucLocationOptional: commonUserCiStructureLocationOptional,
        content: userCiContentEx,
    }
}

const ciExF = (type: CiType, locationOptional: boolean) => intersectionType(ciContentEx[type].struc,
    {
        data: {
            content: ciContentEx[type].content
        }
    })

//todo: data.content missing.. why?
const userCiEx = unionType(...ciTypeUserT.map(x => ciExF(x, false)))
const platformCiEx = unionType(...ciTypePlatformT.map(x => ciExF(x, false)))

//userCi without content and location is optional
const userCiWithoutContentEx = unionType(...ciTypeUserT.map(x => ciContentEx[x].strucLocationOptional))
//#endregion

//#region CI types as values for guards
const sigExampleKid = { signature: "", keyId: "" }
const sigExamplePk = { signature: "", publicKey: "" }

const platformCiContents = unionType(ciContentEx[CiType.Inauguration].content, ciContentEx[CiType.Key].content, ciContentEx[CiType.Log].content)
const platformCiExample0 = {
    data: {
        metadata: {
            platform: "",
            chain: "",
            seqNo: 0,
            type: literalType(...ciTypePlatformT),
            timestamp: new Date(),
            previousCi: optionalType("")
        },
        content: platformCiContents
    },
    signatures: tupleType(unionType(sigExamplePk, sigExampleKid))
}

const userMetadataExample = {
    "platform": "",
    "chain": "",
    "seqNo": 0,
    "timestamp": new Date(),
    "type": "",
    "payment": {
        "amount": 0,
        "unit": ""
    },
    "location": ""
}

const userCiExample0 = {
    data: {
        metadata: userMetadataExample,
        content: {
            data: "",
            signatures: [{ "signature": "", "publicKey": "" }]
        }
    },
    signatures: tupleType(sigExampleKid)
}

const userCiExampleWihoutContent0 = {
    data: { metadata: userMetadataExample },
    signatures: tupleType(sigExampleKid)
}

type UserCiWithoutContent = NestedOmit<UserCi, "data.content">

function userCiExampleGeneric<T extends UserCi | UserCiWithoutContent>(withContent: boolean) {
    const uciEx0 = withContent ? userCiExample0 : userCiExampleWihoutContent0

    return customFullTypePredicate<T>("userCi", (x, retVal) => {
        const rv1 = { value: null }
        if (!hasType(x, uciEx0, rv1)) return retVal(rv1.value)

        //check that signature only has `signature` and `keyId` fields
        const rv2 = { value: null }
        if (!hasType(x.signatures[0], sigExampleKid, rv2, true)) return retVal(rv2.value)
        return retVal()
    })
}

const userCiExample = userCiExampleGeneric<UserCi>(true)
const userCiExampleWithoutContent = userCiExampleGeneric<UserCiWithoutContent>(false)

const platformCiExample = customFullTypePredicate<PlatformCi>("platformCi", (x, retVal) => {
    const rv = { value: null }
    if (!hasType(x, platformCiExample0, rv)) return retVal(rv.value)
    return retVal()
})

function verifyUserCiShape(x: any, rv: { value: null }): x is UserCi {
    return hasType(x, userCiExample, rv)
}

//#endregion
