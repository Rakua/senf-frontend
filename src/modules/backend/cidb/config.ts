export {
    modName, lg, chains, platformName, defaultArchives, stubsDisabled,
    bypassChecks, bypassChecksData, bypassChecksActive
}

import { DefaultLogger } from "../../libs/basic/logger.js"
import { UserChain } from "./types/ci.js"
import { Archive } from "./types/misc.js"

const modName = "cidb"
const lg = new DefaultLogger(modName)
const platformName = "senf.in"
const chains = ["a"]
// const chains = ["t1","qa2","a"]

const defaultArchives: Archive[] = [{
    url: "https://archive.senf.in/"
}]

const stubsDisabled = true


type BypassChecks = Record<UserChain, number>

/**
 * If defined for a chain, the signatures and hashes of 
 * CIs from that chain with sequence no less than or equal 
 * the given number are not verified (signature and hash checks
 * pass without actual verification)
 * 
 * Used for testing in development.
 */
const bypassChecksUntilSeqNo: BypassChecks = {
    // qa2: 500
}

function bypassChecks(chain: UserChain): number | null {
    return bypassChecksUntilSeqNo[chain] ?? null
}

function bypassChecksData(): BypassChecks {
    return structuredClone(bypassChecksUntilSeqNo)
}

function bypassChecksActive(): boolean {
    return Object.keys(bypassChecksUntilSeqNo).length > 0
}