//#region import/export
export {
    //types
    PostItem, PostType, PostTypeTag, ItemLocation,

    //events
    PostEvent,
    PostEventEnqueued, PostEventAborted, PostEventRemoved,
    PostEventSigned, PostEventRequiringSignature,
    PostEventGotTicket, PostEventAdvancedTicket, PostEventPosted, PostEventWorkFailed,
    PostEventWork,

    //main 
    modName, init, addListener, removeListener,

    //state
    getPostById, getEnqueued, getAborted, getPosted,
    stateR, sizeR, autoAbortedSizeR, signatureMissingR, isLockedR,
    enqueuedR, abortedR, postedR,
    enqueuedSizeR, abortedSizeR, postedSizeR,

    //posting API for UI
    enqueue, requestSignature, sign, unsign, abort, remove, removeAllFrom
}

import { settings, modName, lg } from "./config.js"
import { toClientTime } from "../time.js"
import { PostItem } from "./item.js"
import { getEnqueued, getPostById, getAborted, getPosted, cleanOldPosts, emitStateChangedEvents, updatePost } from "./state.js"
import { addListener, PostEvent, PostEventAborted, PostEventAdvancedTicket, PostEventEnqueued, PostEventGotTicket, PostEventPosted, PostEventRemoved, PostEventRemovedAll, PostEventRequiringSignature, PostEventSigned, PostEventWork, PostEventWorkFailed, removeListener } from "./events.js"
import { ItemLocation, PostContent, PostType, PostTypeTag } from "./types.js"
import { abortedR, abortedSizeR, autoAbortedSizeR, enqueuedR, enqueuedSizeR, postedR, postedSizeR, signatureMissingR, sizeR, stateR } from "./reactive.js"
import { listenToWorkEvents, isLockedR, setQueryHandlers, query, scheduleWork } from "./work.js"

import { keyId, plainTextToJsonSignRequest } from "../../libs/etc/sdst.js"
import { CantSignPostWithTicketError, PostDoesNotExistError, PostNotInQueueError, SignedTextDiffersError } from "./errors.js"
import { cancel } from "./request.js"
import { onChange } from "../../libs/basic/reactive.js"
import { SDSTSignRequest } from "../../libs/etc/sdst-request.js"
import { isMainTab, isMainTabR } from "../../libs/etc/tab.js"
import { loadCiIntoDb, userCiExists } from "../cidb/cidb.js"
import { ciMetadata, UserCi } from "../cidb/types/ci.js"
import { deadlineThrow } from "../../libs/basic/misc.js"
//#endregion

function init() {
    const epsilon = settings.epsilonInterval.get()

    setQueryHandlers()

    listenToWorkEvents()
    emitStateChangedEvents()
    addListener(() => { scheduleWork("state changed", epsilon) }, ["stateChanged"])
    onChange(isMainTabR, (isMainTab) => {
        if (!isMainTab) return
        scheduleWork("tab gained main status", epsilon)
        loadPostsIntoDb()
        cleanOldPosts()
    })

    addListener((ev) => {
        if (!isMainTab()) return
        loadPostIntoDb((ev as PostEventPosted).data.post)
    }, ["posted"])

    //cancel ticket if a post gets aborted
    addListener(function (ev) {
        if (!isMainTab()) return
        const post = (ev as PostEventAborted).data.post
        tenaciousCancel(post)
    }, ["aborted"])
}

//#region post API
async function enqueue(postContent: PostContent, shouldBeSigned: boolean) {
    const q = query("enqueue")({ postContent: postContent, shouldBeSigned: shouldBeSigned })
    return await deadlineThrow(q, settings.queryTimeout.get(), "enqueue")
}

/**
 * Sets the signed text of a post. Only call this when a post is signed via 
 * fragment id or manually. For a sign request via postMessage the call to 
 * this function is already part of `requestSignature`.
 * 
 * The return value is async because the the computation of the keyId calls
 * the async sha256 function of crypto.subtle.
 */
async function sign(postId: string, signedPlainText: string) {
    return await sign0(postId, signedPlainText)
}

async function unsign(postId: string) {
    return await sign0(postId, undefined)
}

async function sign0(postId: string, signedPlainText: string | undefined) {
    const gbpi = getPostById(postId)
    if (gbpi == undefined) throw new PostDoesNotExistError(postId)

    const post = gbpi.post
    if (gbpi.location != ItemLocation.Enqueued) throw new PostNotInQueueError(postId, gbpi.location)
    if (post.hasTicket()) throw new CantSignPostWithTicketError(postId, signedPlainText ?? "")

    let signedText
    if (signedPlainText !== undefined) {
        //check that signed text matches post content
        const sr = plainTextToJsonSignRequest(signedPlainText, true)
        if (sr.data as string !== gbpi.post.toText())
            throw new SignedTextDiffersError(postId, signedPlainText)
        signedText = { text: signedPlainText, keyId: await keyId(sr.signatures[0].publicKey!) }
    } else {
        //unsign
        signedText = undefined
    }

    const q = query("sign")({ postId: postId, signedText: signedText })
    return await deadlineThrow(q, settings.queryTimeout.get(), "sign")
}

async function abort(postId: string) {
    return await deadlineThrow(query("abort")(postId), settings.queryTimeout.get(), "abort")
}

async function remove(postId: string) {
    return await deadlineThrow(query("remove")(postId), settings.queryTimeout.get(), "remove")
}

async function removeAllFrom(location: ItemLocation.Posted | ItemLocation.Aborted) {
    return await deadlineThrow(query("removeAll")(location), settings.queryTimeout.get(), "removeAll")
}
//#endregion

//#region misc

/**
 * Requests signature for `post` via postMessage and sets the signed plain text.
 * 
 * @returns true if sign request was signed by user and false if user cancelled it
 */
async function requestSignature(post: PostItem) {
    const options = {
        contextId: post.postId(),
        requirePublicKey: true,
        acceptedAlgorithms: settings.acceptedAlgorithms.get(),
        acceptedDigestMethods: settings.acceptedDigestMethods.get(),
    }

    const signRequest = new SDSTSignRequest(post.toText(), options, settings.sdstUrl.get())
    const resp = await signRequest.start()
    if (resp.signed && resp.contextId === options.contextId) {
        await sign(post.postId(), resp.data as string)
        return true
    }
    return false
}

/**
 * Tries to cancel the ticket in `post` until it succeeds (server responds) or
 * the ticket expires. If `post` has no ticket it does nothing.
 */
async function tenaciousCancel(post: PostItem) {
    const now = new Date()
    //no ticket or ticket expired => no need to send request to server
    if (!post.hasTicket() || toClientTime(post.getTicket()!.validUntil) < now) {
        return
    }

    try {
        await cancel(post)
    } catch (e) {
        lg.log("tenaciousCancel(): failed to cancel %O, retry", e)
        setTimeout(() => tenaciousCancel(post), 3000)
    }
}

async function loadPostIntoDb(post: PostItem) {
    try {
        await loadCiIntoDb(post.ci, true)
    } catch (e) {
        lg.error("Failed to insert CI of post %O into database: %O", post, e)
    }
}

/**
 * Retry to load posts into db that failed to load into db
 */
async function loadPostsIntoDb() {
    for (const item of getPosted()) {
        if (item.ci === undefined) continue
        const ci = item.ci as UserCi
        const ciMd = ciMetadata(ci)
        if (await userCiExists(ciMd.chain, ciMd.seqNo)) continue
        loadPostIntoDb(item)
    }
}
//#endregion
