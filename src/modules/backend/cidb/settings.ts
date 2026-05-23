export { settings }

import { guard, guards, literalGuard, tupleType, unionType, uniqueConstraint } from "../../libs/etc/guard.js"
import { newSettings, SettingEventInvalidValue } from "../../libs/etc/settings.js"
import { defaultArchives, modName } from "./config.js"
import { UserCiPrimaryKey } from "./db/schema/v1.js"
import { devMode, mainSettings } from "../../../config.js"
import { KeyId } from "./types/ci.js"

type AliasSettingType = [KeyId, string][]

const settings = {
    ...newSettings(modName, {
        operator: { default: "RakuaOvA9xLqqyt2lfUXPiW1Aq7f9PyrwpY3aMRza6g" },
        operatorRecovationKey: { default: "???" },

        yourKeyIds: { default: [""] },
        yourAnonCis: { default: [["", 0]] as UserCiPrimaryKey[], guard: guard([tupleType("", 0)]) },
        aliases: { default: [] as AliasSettingType, guard: aliasesGuard() },

        archives: { default: defaultArchives },
        recrawlInterval: { default: 300000 },
        uciFileExtensions: { default: [".jsonl"] },
        abortCheckAfterNIterations: { default: 100 },

        ciBufferSize: { default: 100, guard: guards.positiveInteger },
        urlBufferSize: { default: 100, guard: guards.positiveInteger },
        maxLineLength: { default: 15000, guard: guards.positiveInteger },
        maxCrawledUrlSize: { default: 100000000, guard: guards.positiveInteger },
        recordLimit: { default: 1000, guard: guards.positiveInteger },

        statsTrustLevel: {
            default: "trustSignature",
            guard: literalGuard("trustSignature", "trustFromPostModule", "trustLogCi"),
            description: `trustSignature (default) = all user CIs are immediately used for stats computation
trustFromPostModule = only immediately use user CIs from post module for stats computation (others have to be confirmed via log CI)
trustLogCi = all user CIs have to be confirmed via log CI before they are used for stats computation (max. 2h delay)`
        },

        excludeCrawlJobsFromExport: { default: true },
    }),
    serverUrl: mainSettings.serverUrl
}

settings.yourKeyIds.addListener(ev => yourKeyIdsRepair(ev), ["invalidValue"])
settings.yourAnonCis.addListener(ev => yourAnonCisRepair(ev), ["invalidValue"])
settings.aliases.addListener(ev => aliasesRepair(ev), ["invalidValue"])

function aliasesGuard() {
    return guard([tupleType("", "")], (x: AliasSettingType) => {
        const k = uniqueConstraint()(x.map(x => x[0]))
        if (k !== true) return { reason: { nonUniqueKeyId: k.reason.nonUniqueValue } }
        const a = uniqueConstraint()(x.map(x => x[1]))
        if (a !== true) return { reason: { nonUniqueAlias: a.reason.nonUniqueValue } }

        return true
    })
}

function aliasesRepair(ev: SettingEventInvalidValue) {
    //console.warn("repair: aliases invalid: %O", ev)
    //try to repair aliases
}

function yourKeyIdsRepair(ev: SettingEventInvalidValue) {
}

function yourAnonCisRepair(ev: SettingEventInvalidValue) {
}
