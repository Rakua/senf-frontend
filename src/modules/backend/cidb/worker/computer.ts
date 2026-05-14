//#region import/export
export {
    work0, verifyUserCis, updateStats, addListener, removeListener
}

import { addPublicKeys, getUnusedInfos, getUnusedInfosUpperBound, getUnusedJobs, getUnusedJobsCount, newJobsForCatIds, newLoadedCis, newLocations, newPosters } from "../db/stats.js"
import { setUserCisAsVerified, getUnverifiedUserCis, moveToFake, getUnverifiedUserCiCount } from "../db/uci.js"
import { UserCiPrimaryKey } from "../db/schema/v1.js"
import { ciPrimaryKey } from "../types/ci.js"
import { distinctArray } from "../../../libs/basic/misc.js"
import { Events } from "../../../libs/basic/events.js"
import { modName } from "../config.js"
import { DefaultLogger } from "../../../libs/basic/logger.js"
import { LogCiChecker } from "../db/pci.js"
//#endregion

//#region types
type VerifyProgress = {
    total: number,
    processed: number,
    authentic: number,
    fake: number,
    unverifiable: number,
}

type StatsProgress = {
    location: {
        total: number,
        processed: number
    },
    poster: {
        total: number,
        processed: number
    },
    loaded: {
        total: number,
        processed: number
    }
}

type JobsAndCatsProgress = {
    jobsToProcess: number,
    jobProcessed: number
}
//#endregion

//#region events
type ComputerEvent = ComputerEventVerifying | ComputerEventUpdatingStats | ComputerEventUpdatingJobsAndCats | ComputerEventFinished

type ComputerEventVerifying = {
    type: "verifying",
    data: { progress: VerifyProgress }
}

type ComputerEventUpdatingStats = {
    type: "updatingStats",
    data: { progress: StatsProgress }
}

type ComputerEventUpdatingJobsAndCats = {
    type: "updatingJobsAndCats",
    data: { progress: JobsAndCatsProgress }
}

type ComputerEventFinished = {
    type: "finished",
    data: {
        verifyProgress: VerifyProgress,
        statsProgress: StatsProgress,
        jobsAndCatsProgress: JobsAndCatsProgress
    }
}

const events = new Events<ComputerEvent>({ scope: "global", emitterId: modName + ":computer" })
const addListener = events.export().addListener
const removeListener = events.export().removeListener
const emitEvent = events.emitEvent.bind(events)
//#endregion

//only for debugging
const lg = new DefaultLogger("cidb:computer")

async function work0(lcc: LogCiChecker) {
    let finalVerifyProgress: VerifyProgress
    let finalStatsProgress: StatsProgress
    let finalJobsAndCatsProgress: JobsAndCatsProgress

    lg.debug("computer started work0")
    for await (const progress of verifyUserCis(lcc)) {
        finalVerifyProgress = progress
        emitEvent({
            type: "verifying",
            data: { progress: progress }
        })
        //lg.debug("Verifying user CIs: %O", progress)
    }

    for await (const progress of updateStats()) {
        finalStatsProgress = progress
        emitEvent({
            type: "updatingStats",
            data: { progress: progress }
        })
        //lg.debug("Updating stats: %O", progress)
    }

    for await (const progress of updateJobsAndCats()) {
        finalJobsAndCatsProgress = progress
        emitEvent({
            type: "updatingJobsAndCats",
            data: { progress: progress }
        })
        //lg.debug("Updating stats: %O", progress)
    }

    //todo: sync catIds from t_userCiMetadata to t_userCi  
    emitEvent({
        type: "finished",
        data: {
            verifyProgress: finalVerifyProgress!,
            statsProgress: finalStatsProgress!,
            jobsAndCatsProgress: finalJobsAndCatsProgress!
        }
    })
    lg.debug("computer finished work0")
}

async function* verifyUserCis(lcc: LogCiChecker) {
    const progress: VerifyProgress = {
        total: await getUnverifiedUserCiCount(),
        processed: 0,
        authentic: 0,
        fake: 0,
        unverifiable: 0
    }

    yield progress

    for await (const recs of getUnverifiedUserCis()) {
        const res = await lcc.verifyCis(recs.map(r => r.ci))
        const authentic: { pk: UserCiPrimaryKey, logCiSeqNo: number }[] = []
        const fakes: UserCiPrimaryKey[] = []
        const pubKeys: string[] = []
        for (let i = 0; i < recs.length; i++) {
            const resi = res[i]
            switch (resi.type) {
                case "ok":
                    authentic.push({
                        pk: ciPrimaryKey(recs[i].ci),
                        logCiSeqNo: resi.logCiSeqNo
                    })
                    const sigs = recs[i].ci.data.content.signatures
                    if (Array.isArray(sigs) && sigs.length == 1)
                        pubKeys.push(sigs[0].publicKey)
                    break
                case "fail":
                    fakes.push(ciPrimaryKey(recs[i].ci))
                    break
            }
        }

        lg.debug("computer:verifyUserCis(): fakes %O", fakes)
        lg.debug("computer:verifyUserCis(): verified %O", authentic)
        lg.debug("computer:verifyUserCis(): pubKeys %O", pubKeys)

        await moveToFake(fakes)
        await setUserCisAsVerified(authentic)
        await addPublicKeys(distinctArray(pubKeys))

        progress.processed += recs.length
        progress.authentic += authentic.length
        progress.fake += fakes.length
        progress.unverifiable += recs.length - authentic.length - fakes.length

        yield progress
    }
}

async function* updateStats() {
    const progress: StatsProgress = {
        location: {
            total: await getUnusedInfosUpperBound("location"),
            processed: 0
        },
        poster: {
            total: await getUnusedInfosUpperBound("poster"),
            processed: 0
        },
        loaded: {
            total: await getUnusedInfosUpperBound("loaded"),
            processed: 0
        }
    }
    yield progress

    //update locations
    lg.debug("update stats with new locations")
    for await (const recs of getUnusedInfos("location")) {
        await newLocations(recs)
        progress.location.processed += recs.length
        yield progress
    }
    //correct upper bound to get 100% progress
    progress.location.total = progress.location.processed
    yield progress

    //update posters
    lg.debug("update stats with new posters")
    for await (const recs of getUnusedInfos("poster")) {
        await newPosters(recs)
        progress.poster.processed += recs.length
        yield progress
    }
    //correct upper bound to get 100% progress
    progress.poster.total = progress.poster.processed
    yield progress


    //update loaded stats
    //lg.debug("update stats with new loaded CIs")
    for await (const recs of getUnusedInfos("loaded")) {
        await newLoadedCis(recs)
        progress.loaded.processed += recs.length
        yield progress
    }
    //correct upper bound to get 100% progress
    progress.loaded.total = progress.loaded.processed
    yield progress
}

async function* updateJobsAndCats() {
    const progress: JobsAndCatsProgress = {
        jobsToProcess: await getUnusedJobsCount(),
        jobProcessed: 0
    }

    for await (const recs of getUnusedJobs()) {
        await newJobsForCatIds(recs)

        progress.jobProcessed += recs.length
        if (progress.jobProcessed > progress.jobsToProcess)
            progress.jobProcessed = progress.jobsToProcess
        yield progress
    }
}