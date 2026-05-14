//#region import/export
export {
    PostEvent,

    PostEventEnqueued, PostEventSigned, PostEventAborted, PostEventRemoved, PostEventRemovedAll,
    PostEventRequiringSignature, PostEventGotTicket, PostEventAdvancedTicket, PostEventPosted, PostEventWorkFailed,
    PostEventWork, PostEventStateChanged,

    emitEvent, addListener, removeListener, postItemReviver,
    failedOnServerSide
}

import { Events } from "../../libs/basic/events.js"
import { modName } from "./config.js"
import { ServerError } from "./errors.js"
import { PostItem } from "./item.js"
import { ItemLocation } from "./types.js"
//#endregion

type PostEvent =
    PostEventEnqueued | PostEventSigned | PostEventAborted | PostEventRemoved | PostEventRemovedAll
    | PostEventRequiringSignature | PostEventGotTicket | PostEventAdvancedTicket | PostEventPosted | PostEventWorkFailed
    | PostEventWork | PostEventStateChanged

//#region actions
type PostEventEnqueued = {
    type: "enqueued",
    data: {
        post: PostItem,
        index: number,
    }
}

type PostEventSigned = {
    type: "signed",
    data: {
        post: PostItem
        unsigned: boolean, //true if signature was removed from post
        signedBefore: boolean, //was the post signed before?
    }
}

type PostEventAborted = {
    type: "aborted",
    data: {
        post: PostItem,
        manually: boolean, //true iff post was manually aborted
    }
}

type PostEventRemoved = {
    type: "removed",
    data: {
        post: PostItem,
        from: ItemLocation.Aborted | ItemLocation.Posted,
    }
}

type PostEventRemovedAll = {
    type: "removedAll",
    data: {
        from: ItemLocation.Aborted | ItemLocation.Posted,
    }
}
//#endregion

//#region posting
type PostEventRequiringSignature = {
    type: "requiringSignature",
    data: {
        post: PostItem
    }
}

type PostEventGotTicket = {
    type: "gotTicket",
    data: {
        post: PostItem
    }
}

type PostEventAdvancedTicket = {
    type: "advancedTicket",
    data: {
        post: PostItem
    }
}

type PostEventPosted = {
    type: "posted",
    data: {
        post: PostItem,
        ci: any
    }
}

type PostEventWorkFailed = {
    type: "workFailed",
    data: {
        post: PostItem,
        error: Error
    }
}
//#endregion

//#region etc 
type PostEventWork = {
    type: "work",
    data: {
        reason: string
    }
}

type PostEventStateChanged = {
    type: "stateChanged",
    data: {
        location: ItemLocation
    }
}
//#endregion

const events = new Events<PostEvent>({scope: "global", emitterId: modName, reviver: postItemReviver})
const addListener = events.export().addListener
const removeListener = events.export().removeListener
const emitEvent = events.emitEvent.bind(events)

function postItemReviver(ev: PostEvent): PostEvent {
    switch (ev.type) {
        case "enqueued":
        case "signed":
        case "aborted":
        case "removed":
        case "requiringSignature":
        case "gotTicket":
        case "advancedTicket":
        case "posted":
        case "workFailed":            
            ev.data.post = PostItem.fromObject(ev.data.post)
    }
    return ev
}

function failedOnServerSide(ev: PostEventWorkFailed): boolean {
    return ev.data.error instanceof ServerError
}

