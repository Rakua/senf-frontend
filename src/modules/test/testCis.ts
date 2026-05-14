export { testChainHashes, testLogHashes, testSigs, testAll }

import { lg } from "../../config.dev.js"
import { ciHash, PlatformCi, UserCi, PlatformCiKey, PlatformCiLog, CiType } from "../backend/cidb/types/ci.js"
import { toJson } from "../libs/basic/misc.js"
import { verifyEd25519JsonSignRequest } from "../libs/etc/sdst.js"

// ***IMPORTANT***: remove .000 from timestamps: `.OOOZ"` -> `Z"`
//                  if operator key is not ed25519 the verification of the first two PCIs will fail
//#region test data
const allPci = [] as any[]
const allUci = [] as any[]
//#endregion

const pcis = allPci.map(z => z.ci) as unknown as PlatformCi[]
const ucis = allUci.map(z => z.ci) as unknown as UserCi[]
const cis = pcis.concat(ucis as any)

async function testAll() {
    await testChainHashes()
    await testSigs()
    await testLogHashes()
}

/**
 * Tests whether previousCi hash in CI n+1 matches the actual hash of CI n
 * for both platform and user chain.
 */
async function testChainHashes() {
    const allCis = [pcis, ucis]
    for (const cis of allCis) {
        const chain = cis[0].data.metadata.chain
        lg.info("checking previous hashes of chain %s (%s CIs)", chain, cis.length)
        cis.sort((x, y) => x.data.metadata.seqNo - y.data.metadata.seqNo)
        let validN = 0
        let invalidN = 0
        for (let i = 0; i < cis.length; i++) {
            const ci = cis[i]
            const ci2 = cis[i + 1]
            const seqNo = ci.data.metadata.seqNo

            const hash = await ciHash(ci)
            if (ci2 == undefined) {
                //lg.info("last CI: i %O seqNo %O chain %O", i, seqNo, ci.data.metadata.chain)
            } else {
                //check previous hash
                const referenceHash = ci2.data.metadata.previousCi!
                if (hash !== referenceHash) {
                    lg.error("hash mismatch for seqNo %O\nGOT: %s\nEXP: %s", seqNo, hash, referenceHash)
                    invalidN++
                } else {
                    validN++
                }
            }

        }
        lg.info("finished checking previous hashes of chain %s (%O valid, %O invalid)", chain, validN, invalidN)
    }
}

/**
 * Returns public key lookup map for platform signing keys
 */
function getPkLookup() {
    const keys0 = pcis.filter(pci => pci.data.metadata.type == CiType.Key) as PlatformCiKey[]
    const keys = keys0.map(k => [k.data.content.keyId, k.data.content.publicKey] as [string, string])
    return new Map<string, string>(keys)
}

/**
 * Checks the platform signatures of all CIs (platform and user)
 * 
 * If the operator uses non-ed25519 key pair the verification of the
 * first two PCIs will fail.
 */
async function testSigs(ignoreOpPci?: boolean) {
    ignoreOpPci ??= false

    let invalidN = 0
    let validN = 0

    const lu = getPkLookup()

    const cisCopy = structuredClone(cis)

    lg.info("test sigs of all cis (%s = %s + %s)", cis.length, allPci.length, allUci.length)
    for (const ci of cisCopy) {

        if (!(ci.signatures[0] as any).publicKey) {
            //add pubkey
            (ci.signatures[0] as any).publicKey = lu.get(ci.signatures[0].keyId)
        }

        if (ignoreOpPci && ci.data.metadata.type.startsWith("platform") && (ci.data.metadata.seqNo == 1 || ci.data.metadata.seqNo == 2)) {
            lg.info("Verify op PCI in SDST:\n%s", toJson(ci))
            validN++
            continue
        }

        const res = await verifyEd25519JsonSignRequest(ci)

        if (!res.signatures[0].isValid) {
            lg.error("Invalid signature for ci:\n%s", toJson(ci))
            invalidN++
        } else {
            validN++
            //lg.error("Valid signature for ci %O", ci)
        }
    }
    lg.info("finished testing signatures (%O valid, %O invalid)", validN, invalidN)

}

/**
 * Test whether the CI hashes in the platform logs matches the actual CI hashes
 */
async function testLogHashes() {
    //get log cis
    const logCis = pcis.filter(x => x.data.metadata.type == CiType.Log) as unknown as PlatformCiLog[]
    const lu = new Map<number, string>()
    for (const lci of logCis) {
        for (const le of lci.data.content) {
            lu.set(le.seqNo, le.hash)
        }
    }

    let validN = 0
    let invalidN = 0

    lg.info("testing log hashes %s", ucis.length)
    for (const uci of ucis) {
        const hash = await ciHash(uci)
        const expHash = lu.get(uci.data.metadata.seqNo)
        if (hash !== expHash) {
            invalidN++
            const uciPk = uci.data.metadata.seqNo.toString()+uci.data.metadata.chain
            lg.error("hash log wrong for %s \nGOT: %s\nEXP: %s\n%s", uciPk, hash, expHash, JSON.stringify(uci,null,2))
        } else {
            validN++
        }
    }
    lg.info("finished testing log hashes (%O valid, %O invalid)", validN, invalidN)
}

