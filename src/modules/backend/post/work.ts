//#region import/export
export { scheduleWork, listenToWorkEvents, setQueryHandlers, query, isLockedR }

import { ReactiveAtom, readOnlyReactiveValue } from "../../libs/basic/reactive.js"
import { isMainTab, queryMainTab, setMainTabQueryHandler } from "../../libs/etc/tab.js"
import { lg, modName, settings } from "./config.js"
import { PostDoesNotExistError } from "./errors.js"
import { emitEvent, PostEventEnqueued, PostEventSigned, PostEventAborted, PostEventRequiringSignature, PostEventGotTicket, PostEventAdvancedTicket, PostEventPosted, PostEventWorkFailed, PostEventRemoved, addListener, PostEventRemovedAll, postItemReviver } from "./events.js"
import { PostItem } from "./item.js"
import { ticket, wait, submit, cancel } from "./request.js"
import { insertInQueue, getPostById, updatePost, moveToAborted, getEnqueued, moveToPosted, removeFrom, removeAllFrom } from "./state.js"
import { toClientTime } from "../time.js"
import { ItemLocation, PostContent, SignedText } from "./types.js"
import { scheduleWork } from "./schedule.js"
import { sleep } from "../../libs/basic/misc.js"
//#endregion

//#region types
type PostId = string
type EnqueueQueryInput = { postContent: PostContent, shouldBeSigned: boolean }
type SignQueryInput = { postId: PostId, signedText: SignedText | undefined } //undefined => unsign post
type RemoveAllQueryInput = "posted" | "aborted"
type QueryHandlers = typeof queryHandlers

type QueryHandlerData<T extends keyof QueryHandlers> =
    QueryHandlers[T] extends (x: infer A) => infer B
    ? { input: A, output: B } : never

type NextAvailableSlot = {
    "postTimeClient": Date,
    "index": number
}
//#endregion

const queryHandlers = {
    "enqueue": enqueueHandler,
    "sign": signHandler,
    "abort": abortHandler,
    "remove": removeHandler,
    "removeAll": removeAllHandler
} as const

/**
 * Calls `work()` whenever a WorkEvent is emitted
 */
const listenToWorkEvents = () => addListener(work, ["work"])

const isLocked = new ReactiveAtom(false)
const isLockedR = readOnlyReactiveValue(isLocked)

const requestLock = async <T>(f: () => Promise<T>) => {
    const f1 = async () => {
        isLocked.set(true)
        const res = await f()
        setTimeout(() => isLocked.set(false),0)
        return res
    }
    return await navigator.locks.request(modName + ":work", f1)
}

async function work() {
    if (!isMainTab()) return

    await requestLock(async () => {
        try {
            await processEnqueued()
        } catch (e) {
            const post = getEnqueued()[0]
            lg.error("Work failed for post %O because %O", post, e)
            emitEvent({
                type: "workFailed",
                data: {
                    post: post,
                    error: e as Error
                }
            })
        }
    })
}

async function processEnqueued() {
    //got lock => start working
    const now = new Date()
    const queue = getEnqueued()
    const post = queue[0]
    try {
        if (queue.length == 0) return

        const postTimeClient = post.getPostTime().client
        const validFrom = () => toClientTime(post.getTicket()!.validFrom)
        const validUntil = () => toClientTime(post.getTicket()!.validUntil)
        const tooSoon = () => //true iff retry interval after last error in current phase has not passed yet 
            post.lastErrorInCurrentPhase() != null
            && new Date(post.lastErrorInCurrentPhase()!.date.getTime() + settings.postRetryInterval.get()) > now

        //post must be signed
        if (post.missingSignature()) {

            if (postTimeClient.getTime() + settings.postWaitForSignatureFor.get() < now.getTime()) {
                //waited too long for signature => move post to aborted
                post.appendError(new Error("signature missing"))
                updatePost(post)
                moveToAborted(post.postId())
                return
            }

            lg.warn("post %s should be signed but is not signed yet", post.postId())
            emitEvent({
                type: "requiringSignature",
                data: {
                    post: post
                }
            })

            scheduleWork("waiting for signature", settings.postWaitForSignatureFor.get())
            return
        }

        //post is scheduled for later
        if (postTimeClient > now) {
            const timeUntilWork = postTimeClient.getTime() - now.getTime()
            lg.log("post %s scheduled in %s seconds (%s)", post.postId(), Math.round(timeUntilWork / 1000), postTimeClient)

            scheduleWork("post was scheduled for later", timeUntilWork)
            return
        }

        //get ticket
        if (!post.hasTicket()) {
            lg.log("trying to get a ticket for post %s", post.postId())

            //no ticket yet and expired => move to aborted
            if (new Date(postTimeClient.getTime() + settings.postExpiresAfter.get()) < now) {
                lg.log("post %s expired (postTimeClient: %O); moving to aborted", post.postId(), postTimeClient)
                post.appendError(new Error("post time expired"))
                updatePost(post)
                moveToAborted(post.postId())

                emitEvent({
                    type: "aborted",
                    data: {
                        post: post,
                        manually: false
                    }
                })
            }

            if (tooSoon()) {
                lg.log("too soon to get a ticket since last error for post %s", post.postId())
                scheduleWork("too soon since last error", settings.postRetryInterval.get())
                return
            }

            post.setTicket(await ticket(post))
            updatePost(post)

            const timeUntilWork = (validFrom()).getTime() - now.getTime()
            scheduleWork("finished waiting", timeUntilWork)

            lg.log("got ticket %O for post %s, next work at %s", post.getTicket(), post.postId(), validFrom())
            emitEvent({
                type: "gotTicket",
                data: {
                    post: post
                }
            })

            return
        }

        //post has ticket but it expired => move to aborted
        if (validUntil() < now) {
            lg.log("post %s has ticket but it expired => move post to aborted", post.postId())
            post.appendError(new Error("ticket expired"))
            updatePost(post)
            moveToAborted(post.postId())

            //emit event post moved to aborted
            emitEvent({
                type: "aborted",
                data: {
                    post: post,
                    manually: false
                }
            })
            return
        }

        //post has ticket but it is not valid yet
        if (validFrom() > now) {
            lg.log("post %s has ticket but it is not valid yet, next work at %s", post.postId(), validFrom())
            scheduleWork("wait", validFrom().getTime() - now.getTime())
            return
        }

        //ticket valid but not redeemable yet => advance ticket
        if (post.getTicket()!.elapsedWaitingTimeSec < post.getTicket()!.requestedWaitingTimeSec) {
            if (tooSoon()) {
                lg.log("too soon to advance the ticket since last error for post %s", post.postId())
                scheduleWork("too soon since last error", settings.postRetryInterval.get())
                return
            }

            post.setTicket(await wait(post))
            updatePost(post)
            scheduleWork("ticket got valid", Math.max(settings.epsilonInterval.get(), validFrom().getTime() - now.getTime()))
            lg.log("advanced ticket %O for post %s", post.getTicket(), post.postId())
            emitEvent({
                type: "advancedTicket",
                data: {
                    post: post
                }
            })
            return
        }

        //ticket valid and redeemable => submit post
        {
            lg.log("submitting post %s", post.postId())
            if (tooSoon()) {
                lg.log("too soon to submit post %s since last error", post.postId())
                scheduleWork("too soon since last error", settings.postRetryInterval.get())
                return
            }

            const ci = await submit(post)
            lg.log("post %s submitted, got CI %O", post.postId(), ci)
            post.setCi(ci)
            updatePost(post)
            moveToPosted(post.postId())
            emitEvent({
                type: "posted",
                data: {
                    post: post,
                    ci: ci
                }
            })
            return
        }

    } catch (e) {
        //append error and update post
        post.appendError(e as Error)
        updatePost(post)

        //emit error event and write to log
        lg.error("failed to work on post %s, error: %O", post.postId(), e)
        emitEvent({
            type: "workFailed",
            data: {
                post: post,
                error: e as Error,
            }
        })

        //if post exceeded retries in current phase move to aborted & try to cancel ticket
        const maxRetries = settings.postRetriesPerPath.get()
        const curPhase = post.currentPhase()
        const exceededRetries = post.countErrorsInCurrentPhase() > maxRetries
        if (exceededRetries) {
            moveToAborted(post.postId())
            lg.error("aborted post %s since it exceeded max retries (%s) in phase %O", post.postId(), maxRetries, curPhase)
            emitEvent({
                type: "aborted",
                data: {
                    post: post,
                    manually: false
                }
            })
        }
    }
}


/**
 * @returns next possible postTimeClient and index in queue for given waitingTime
 */
function nextAvailableSlot(waitingTimeMs: number): NextAvailableSlot {
    const now = new Date()
    const waitingTimeMin = waitingTimeMs / 60000

    const queue = getEnqueued()
    const firstPost = queue[0]
    const lastPost = queue[queue.length - 1]
    if (queue.length == 0) {
        lg.debug(waitingTimeMin + "min waiting time + empty queue => enqueueable as first post")
        return {
            "postTimeClient": now,
            "index": 0
        }
    }

    //fits before first post in queue?
    const deadline = new Date(now.getTime() + waitingTimeMs)
    if (deadline < firstPost.getPostTime().client) {
        lg.debug(waitingTimeMin + "min waiting time => fits before post #1")
        return {
            "postTimeClient": now,
            "index": 0
        }
    }

    //fits between two posts in queue?
    for (let i = 0; i < queue.length - 1; i++) {
        const post1 = queue[i]
        const post2 = queue[i + 1]
        //if (post2.getPostTimeClient().getTime() - post1.earliestSubmissionDate().getTime() > waitingTimeMs) {
        if (post2.getPostTime().client.getTime() - estimatedSubmissionDate(post1.postId()).getTime() + 30000 > waitingTimeMs) {
            lg.debug(waitingTimeMin + "min waiting time => enqueueable after post #" + (i + 1))
            return {
                "postTimeClient": post1.earliestSubmissionDate(),
                "index": i + 1
            }
        }
    }

    //must be inserted at the end of the queue
    lg.debug(waitingTimeMin + "min waiting time => enqueueable at the end")
    return {
        "postTimeClient": lastPost.earliestSubmissionDate(),
        "index": queue.length
    }
}

async function enqueueHandler(input: EnqueueQueryInput): Promise<PostEventEnqueued> {
    return await requestLock(async () => {
        const post = new PostItem(input.postContent, input.shouldBeSigned)
        const slot = nextAvailableSlot(post.getWaitingTime())
        post.setPostTime(slot.postTimeClient)
        insertInQueue(post, slot.index)
        const ev = {
            type: "enqueued",
            data: {
                post: post,
                index: slot.index
            }
        } as PostEventEnqueued
        emitEvent(ev)
        return ev
    })
}

async function signHandler(input: SignQueryInput): Promise<PostEventSigned> {
    return await requestLock(async () => {
        const postId = input.postId
        const gpbi = getPostById(input.postId)
        if (gpbi == undefined) {
            const err = new PostDoesNotExistError(postId)
            lg.error("Can't sign post: %O", err)
            throw err
        }

        const post = gpbi!.post
        const signedBefore = post.isSigned()
        const unsign = input.signedText == undefined
        if (unsign) {
            post.unsetSignedText()
            post.setShouldBeSigned(false)
        } else {
            post.setSignedText(input.signedText!)
        }
        updatePost(post)

        const ev: PostEventSigned = {
            type: "signed",
            data: {
                post: post,
                unsigned: unsign,
                signedBefore: signedBefore
            }
        }
        emitEvent(ev)
        return ev
    })
}

async function abortHandler(input: PostId): Promise<PostEventAborted> {
    return await requestLock(async () => {
        const postId = input
        const gpbi = getPostById(postId)
        if (gpbi === undefined) {
            const err = new PostDoesNotExistError(postId)
            lg.error("Can't abort post: %O", err)
            throw err
        }
        const post = gpbi!.post

        //move post to aborted
        if (!moveToAborted(postId)) {
            lg.error("post not in queue: %O", post)
            throw new Error("post " + postId + " not in queue")
        }
        post.setAbortedByUser()
        updatePost(post)

        if (post.hasTicket()) {
            let cancelledTicket = false
            for (let i = 0; i < 3; i++) {
                try {
                    await cancel(post)
                    cancelledTicket = true
                    break
                } catch (e) {
                    lg.error("failed to cancel ticket for post %O: %O", post, e)
                }
            }
            if (!cancelledTicket) {
                lg.error("ultimately failed to cancel ticket for post %O", post)
            }
        }

        lg.log("aborted post %s", postId)
        const ev: PostEventAborted = {
            type: "aborted",
            data: {
                post: post,
                manually: true
            }
        }
        emitEvent(ev)
        return ev
    })
}

async function removeHandler(input: PostId): Promise<PostEventRemoved> {
    return await requestLock(async () => {
        const postId = input
        const gpbi = getPostById(postId)
        if (gpbi === undefined) {
            const err = new PostDoesNotExistError(postId)
            lg.error("Can't remove post: %O", err)
            throw err
        }
        const post = gpbi!.post
        if (gpbi.location == ItemLocation.Enqueued) {
            lg.error("Can't remove post from enqueued: %O", post)
            throw new Error("Can't remove post " + postId + " from enqueued")
        }

        if (!removeFrom(postId, gpbi.location)) {
            lg.impossible("Failed to remove post %O from %s", post, gpbi.location)
            throw new Error("Failed to remove post " + postId + " from " + gpbi.location)
        }

        const ev: PostEventRemoved = {
            type: "removed",
            data: {
                post: post,
                from: gpbi.location
            }
        }
        emitEvent(ev)
        return ev
    })
}

async function removeAllHandler(input: RemoveAllQueryInput): Promise<PostEventRemovedAll> {
    return await requestLock(async () => {
        const location = input == "posted" ? ItemLocation.Posted : ItemLocation.Aborted
        removeAllFrom(location)
        const ev: PostEventRemovedAll = {
            type: "removedAll",
            data: {
                from: location
            }
        }
        emitEvent(ev)
        return ev
    })
}

/**
 * Only for enqueued posts; otherwise throws PostDoesNotExist error
 */
function estimatedSubmissionDate(postId: string) {
    const items = getEnqueued()

    let submissionDate: Date
    for (const [index, item] of items.entries()) {
        submissionDate = index == 0
            ? item.earliestSubmissionDate()
            : new Date(Math.max(item.getPostTime().client.getTime(), submissionDate!.getTime()) + item.getWaitingTime())

        if (item.postId() == postId) return submissionDate
    }

    throw new PostDoesNotExistError(postId)
}

function setQueryHandlers() {
    for (const t0 in queryHandlers) {
        const t = t0 as keyof QueryHandlers
        setMainTabQueryHandler(modName, t, queryHandlers[t] as any, { output: postItemReviver })
    }
}

/**
 * Returns type-safe query function
 */
function query<T extends keyof QueryHandlers>(type: T) {
    return (input: QueryHandlerData<T>["input"]) => queryMainTab(modName, type, input) as QueryHandlerData<T>["output"]
}
