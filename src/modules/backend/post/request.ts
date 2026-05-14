export { ticket, wait, waitTid, submit, cancel, cancelTid }

import { PostPath, Ticket } from "./types.js"
import { lg, settings } from "./config.js"
import { ServerError } from "./errors.js"
import { PostItem } from "./item.js"
import { toJson } from "../../libs/basic/misc.js"
import { proxiedFetchJson } from "../../libs/etc/fetch.js"
import { UserCi } from "../cidb/types/ci.js"

/**
 * Gets a ticket 
 */
async function ticket(post: PostItem) {
    const ticketFromServer = await (generic<Ticket>(PostPath.Ticket, post.ciText()))
    return ticketFromServer
}

/**
 * Advances a ticket and returns updated ticket
 */
async function wait(post: PostItem) {    
    return await waitTid(post.ticketId())
}

async function waitTid(ticketId: string) {
    const ticketFromServer = await (generic<Ticket>(PostPath.Wait, ticketId))    
    return ticketFromServer
}

/**
 * @returns CI on success; otherwise throws error
 */
async function submit(post: PostItem) {
    return await generic<UserCi>(PostPath.Submit, post.ciText())
}

async function generic<T>(action: PostPath, body: string) {
    const resp = await proxiedFetchJson(endpoint(action), {
        "method": "POST",
        "body": body,
        "signal": AbortSignal.timeout(settings.fetchTimeout.get())
    })
    if(!resp.data.ok) {
        lg.impossible("Server endpoint %s sent invalid JSON string %s: %O", endpoint(action), toJson(resp.text), resp.data.error)
        throw new Error("Server sent invalid JSON "+toJson(resp.text)+": "+resp.data.error.message)
    }
    const data = resp.data.value 
    if (data.err !== undefined) throw new ServerError(action, data.err, data.errMsg)
    return data as T
}


/**
 * @returns true iff ticket was cancelled; throws error if server could not be reached
 */
async function cancel(post: PostItem) {
    return await cancelTid(post.ticketId())
}

async function cancelTid(ticketId: string) {
    const resp = await fetch(endpoint(PostPath.Cancel), {
        "method": "POST",
        "body": ticketId,
        "signal": AbortSignal.timeout(settings.fetchTimeout.get())
    })
    const ok = resp.status == 200
    if (ok) lg.info("cancelled ticket %s", ticketId)
    return ok
}

function endpoint(action: PostPath) {
    return settings.serverUrl.get() + "/post/" + action
}