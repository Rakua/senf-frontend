export { modName, settings, lg }

import { DefaultLogger } from "../../libs/basic/logger.js"
import { guards } from "../../libs/etc/guard.js"
import { newSettings } from "../../libs/etc/settings.js"

import { mainSettings } from "../../../config.js"

const modName = "post"
const lg = new DefaultLogger(modName)

const settings = {
    ...newSettings(modName, {
        minWaitingTime: { default: 60000, guard: guards.positiveInteger },
        postTimeOffset: { default: 1000, guard: guards.positiveInteger, description: "subtracted from timestamp used in CI text to prevent future error from server (server timestamp < timestamp in CI)" },
        fetchTimeout: { default: 3000, guard: guards.positiveInteger },
        queryTimeout: { default: 3000, guard: guards.positiveInteger },
        postRetentionPeriod: { default: 86400000, guard: guards.positiveInteger },

        postRetryInterval: { default: 1000, guard: guards.positiveInteger },
        postRetriesPerPath: { default: 3, guard: guards.positiveInteger },
        postExpiresAfter: { default: 180000, guard: guards.positiveInteger },
        cancelRetryInterval: { default: 400, guard: guards.positiveInteger },
        postWaitForSignatureFor: { default: 60000, guard: guards.positiveInteger },
        epsilonInterval: { default: 3, guard: guards.positiveInteger }
    }),

    platformName: mainSettings.platformName,
    serverUrl: mainSettings.serverUrl,
    sdstUrl: mainSettings.sdstUrl,
    acceptedAlgorithms: mainSettings.acceptedAlgorithms,
    acceptedDigestMethods: mainSettings.acceptedDigestMethods
}