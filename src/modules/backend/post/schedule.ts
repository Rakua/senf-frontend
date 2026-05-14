export { scheduleWork }

import { lg } from "./config.js"
import { emitEvent } from "./events.js"

type WorkEvent = { reason: string, time: Date }
let scheduledWorkEvents: WorkEvent[] = []

/**
 * Emits a PostEventWork event after `delayInMs`. If another
 * work event is scheduled at exactly the same time, no additional 
 * event is emitted.
 */
function scheduleWork(reason: string, delayInMs: number) {
    //keep track of scheduled dates (ordered list) and don't schedule if it is to close to existing one
    const now = new Date()
    const startsAt = new Date(now.getTime() + delayInMs)

    //remove all event dates in the past
    scheduledWorkEvents = scheduledWorkEvents.filter(we => we.time >= now)

    //don't schedule work if another work event is scheduled for the same time    
    if (scheduledWorkEvents.some(we => we.time.getTime() == startsAt.getTime())) {
        //lg.debug("did not schedule work for %s (work already scheduled for this time)", reason)
        return false
    }

    scheduledWorkEvents.push({ reason: reason, time: startsAt })
    setTimeout(function () {
        emitEvent({
            type: "work",
            data: { reason: reason }
        })
    }, delayInMs)
    //lg.debug("scheduled work %s for %s", reason, startsAt)
    return true
}
