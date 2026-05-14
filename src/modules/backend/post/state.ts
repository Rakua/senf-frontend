//#region import/export
export {
    getItems, getEnqueued, getAborted, getPosted, getPostById,
    updatePost, removeFrom, removeAllFrom,
    insertInQueue, moveToAborted, moveToPosted, cleanOldPosts,
    emitStateChangedEvents
}

import { modName, settings, lg } from "./config.js"
import { PostItem } from "./item.js"
import { IsolatedStorage } from "../../libs/etc/storage.js"
import { ItemLocation } from "./types.js"
import { emitEvent } from "./events.js"
import { ciMetadata, UserCi } from "../cidb/types/ci.js"
import { userCiExists } from "../cidb/cidb.js"
//#endregion

const storage = new IsolatedStorage("local", modName)

/**
 * Emit StateChanged event whenever the local storage in state.ts is mutated 
 */
function emitStateChangedEvents() {
    storage.addListener((ev) => {
        const legalLocations = Object.values(ItemLocation) as string[]
        if (!legalLocations.includes(ev.data.key as string)) return
        emitEvent({
            type: "stateChanged",
            data: { location: ev.data.key as ItemLocation }
        })

    })
}

//#region getters
function getEnqueued() {
    return getItems(ItemLocation.Enqueued)
}

function getPosted() {
    return getItems(ItemLocation.Posted)
}

function getAborted() {
    return getItems(ItemLocation.Aborted)
}

//looks for post id in queue, posted and aborted and returns it
function getPostById(postId: string) {
    for (const loc of Object.values(ItemLocation)) {
        const item = getItems(loc).find(item => item.postId() == postId)
        if (item !== undefined) return { "location": loc, "post": item }
    }
    return undefined
}
//#endregion

//#region mutators

/**
 * @returns true iff post exists and was updated 
 */
function updatePost(post: PostItem) {
    for (const loc of Object.values(ItemLocation)) {
        const items = getItems(loc)
        for (let i = 0; i < items.length; i++) {
            if (items[i].postId() == post.postId()) {
                //update post
                items[i] = post
                storage.set(loc, items)
                return true
            }
        }
    }
    return false
}

function removeAllFrom(location: ItemLocation.Aborted | ItemLocation.Posted) {
    storage.delete(location)
}

//remove posts older than postRetentionPeriod from posted and aborted
function cleanOldPosts() {    
    const ciExistsInDb = async (x: UserCi) => await userCiExists(ciMetadata(x).chain, ciMetadata(x).seqNo)


    const postTimeCi = (x: PostItem) => (x.ci != undefined ? ciMetadata(x.ci).timestamp : undefined) as Date | undefined
    const postTimePost = (x: PostItem) => x.postTime?.client

    const now = new Date()
    for (const loc of [ItemLocation.Aborted, ItemLocation.Posted]) {
        const items = getItems(loc)
        //if the post is in Aborted use post time, otherwise the CI's timestamp
        const postTimeF = loc == ItemLocation.Posted ? postTimeCi : postTimePost

        const freshItems = []
        for (let i = 0; i < items.length; i++) {
            const postTime = postTimeF(items[i])
            if (postTime === undefined) {
                //don't delete post because this case should not be possible (bug?)
                lg.impossible("Post time is undefined for post %O in %s", items[i], loc)
                freshItems.push(items[i])
                continue
            }

            if (new Date(postTime.getTime() + settings.postRetentionPeriod.get()) >= now) {
                //don't delete post because it has not exceeded the retention period
                freshItems.push(items[i])
                continue
            }

            if (items[i].ci !== undefined && !ciExistsInDb(items[i].ci)) {
                //don't delete because post has CI that has not been loaded into CIDB yet
                lg.log("Post with CI %O was not removed because it has not been loaded into the CIDB yet", items[i].ci)
                freshItems.push(items[i])
                continue
            }

            lg.log("Removed post %O in %s because retention period expired", items[i], loc)
        }
        storage.set(loc, freshItems)
    }
}

function insertInQueue(post: PostItem, position: number) {
    const queue = getItems(ItemLocation.Enqueued)
    queue.splice(position, 0, post)
    storage.set(ItemLocation.Enqueued, queue)
}

function moveToPosted(postId: string) {
    return moveTo(ItemLocation.Posted, postId)
}

function moveToAborted(postId: string) {
    return moveTo(ItemLocation.Aborted, postId)
}

function removeFrom(postId: string, loc: ItemLocation) {
    const items = getItems(loc)
    const i = items.findIndex(item => item.postId() == postId)
    if (i == -1) return false

    const removedPost = items[i]
    items.splice(i, 1)
    storage.set(loc, items)

    return true
}
//#endregion

//#region private

/**
 * @returns true iff post was found in enqueued and moved to location
 */
function moveTo(loc: ItemLocation, postId: string) {
    const gpbi = getPostById(postId)
    if (gpbi === undefined || gpbi.location != ItemLocation.Enqueued) return false

    const post = gpbi.post
    removeFrom(postId, ItemLocation.Enqueued)
    const items = getItems(loc)
    items.push(post)
    storage.set(loc, items)
    return true
}

function getItems(location: ItemLocation): PostItem[] {
    const items = storage.get(location)
    if (items === undefined) return []

    //todo: check shape of items with guard

    if (!Array.isArray(items)) {
        lg.error("value in location %s in localStorage is not an array (will be deleted)", location)
        storage.delete(location)
        return []
    }

    return items.map(x => PostItem.fromObject(x))
}
//#endregion