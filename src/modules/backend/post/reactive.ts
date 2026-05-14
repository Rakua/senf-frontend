export {
    stateR, enqueuedR, postedR, abortedR,
    sizeR, enqueuedSizeR, postedSizeR, abortedSizeR, autoAbortedSizeR,
    signatureMissingR
}

import { RemovableListenerId } from "../../libs/basic/events.js"
import { reactiveExpression, ReactiveValue } from "../../libs/basic/reactive.js"
import { addListener, PostEventStateChanged, removeListener } from "./events.js"
import { PostItem } from "./item.js"
import { getAborted, getEnqueued, getItems, getPosted } from "./state.js"
import { ItemLocation } from "./types.js"

const enqueuedR: ReactiveValue<PostItem[]> = {
    get: getEnqueued,
    onChange: f => onChange(ItemLocation.Enqueued, f)
}

const postedR: ReactiveValue<PostItem[]> = {
    get: getPosted,
    onChange: f => onChange(ItemLocation.Posted, f)
}

const abortedR: ReactiveValue<PostItem[]> = {
    get: getAborted,
    onChange: f => onChange(ItemLocation.Aborted, f)
}

const enqueuedSizeR = reactiveExpression([enqueuedR], x => x.length)
const postedSizeR = reactiveExpression([postedR], x => x.length)
const abortedSizeR = reactiveExpression([abortedR], x => x.length)
const autoAbortedSizeR = reactiveExpression([abortedR], (x: PostItem[]) => x.filter(y => !y.isAbortedByUser()).length)
const signatureMissingR = reactiveExpression([enqueuedR], (x: PostItem[]) => x.some(y => y.missingSignature()))

const stateR: { [key in ItemLocation]: ReactiveValue<PostItem[]> } = {
    "enqueued": enqueuedR,
    "posted": postedR,
    "aborted": abortedR
}

const sizeR: { [key in ItemLocation]: ReactiveValue<number> } = {
    "enqueued": enqueuedSizeR,
    "posted": postedSizeR,
    "aborted": abortedSizeR
}

//const askBeforeClosingR = reactiveExpression((isWriterTab, isLocked, enqueued) => isWriterTab && (isLocked || enqueued.length > 0), [isWriterTabR, isLockedR, enqueuedR])

function onChange(location: ItemLocation, f: (nv: PostItem[]) => void): RemovableListenerId[] {
    const g = async function (ev: PostEventStateChanged) {
        if (ev.data.location == location) f(getItems(location))
    }
    return [{
        listenerId: addListener(g, ["stateChanged"]),
        removeListener: removeListener
    }]
}