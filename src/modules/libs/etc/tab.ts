/**
 * There is only one main tab at any given time. A tab keeps its main status 
 * until one of the following happens:
 * - the tab is closed
 * - it gives up its main status (call to relinquishMainTabStatus)
 * - a DOMException causes the main tab to lose its lock
 * 
 * If an instance of this module is run from within a webworker or within
 * an iframe then it cannot become a main tab, see `canBecomeMainTab`.
 */


//#region import/export
export {
    modName, init,
    isMainTab, mainTabExists, isMainTabR, canBecomeMainTab,
    relinquishMainTabStatus,
    postMessageToMainTab, postMessageToAllTabs, postMessageToOtherTabs,
    setMainTabQueryHandler, queryMainTab,
    addListener, addListenerForMainTab, addListenerForAllTabs, addListenerForBecomingMainTab, addListenerForLosingMainTabStatus,
    removeListener
}

import { EventHandler, Events } from "../basic/events.js"
import { DefaultLogger } from "../basic/logger.js"
import { ReactiveAtom, readOnlyReactiveValue } from "../basic/reactive.js"
//#endregion

//#region message & query related types
type Message<ModuleName extends string = string, TypeName extends string = string, T = any> = {
    module: ModuleName,
    type: TypeName,
    content: T
}

type QueryMessage<T> = Message<typeof modName, typeof queryMessageType, QueryMessageContent<T>>
type QueryMessageContent<T> = {
    module: string,     //module where the query is defined
    type: string,       //type of query
    id: string,
    data: T
}

type Query<QueryData> = QueryMessage<QueryData>
type QueryReply<ReplyData, ExceptionData = any> = QueryMessage<
    { ok: true, reply: ReplyData } |
    { ok: false, exception: ExceptionData }
>

type QueryHandlers = Record<ModuleName, Record<TypeName, {
    handler: (msg: any) => Promise<any>,
    revivers: Revivers<any, any>,
}>>
type Revivers<Input, Output> = {
    input?: (x: Input) => Input,
    output?: (x: Output) => Output
}
type ModuleName = string
type TypeName = string
//#endregion

//#region events
type TabEvent = TabEventBecameMainTab | TabEventRelinquishedMainTabStatus | TabEventLostMainTabStatus
    | TabEventMessageForMainTab | TabEventMessageForAllTabs

type TabEventBecameMainTab = {
    type: "becameMainTab",
    data: {}
}

type TabEventRelinquishedMainTabStatus = {
    type: "relinquishedMainTabStatus",
    data: { reason: any }
}

type TabEventLostMainTabStatus = {
    type: "lostMainTabStatus",
    data: { reason: any }
}

/**
 * This type of event is only received by the main tab
 */
type TabEventMessageForMainTab = {
    type: "messageForMainTab",
    data: {
        fromMainTab: boolean, //true => event was not sent via bc => don't apply transformer
        message: Message
    }
}

type TabEventMessageForAllTabs = {
    type: "messageForAllTabs"
    data: {
        message: Message
    }
}
//#endregion

//#region module variables
const modName = "tab"
const lg = new DefaultLogger(modName)
const events = new Events<TabEvent>()
const addListener = events.export().addListener
const removeListener = events.export().removeListener

const mainTabLockName = `sf:${modName}:mainTab`
const mainTabChan = new BroadcastChannel(`sf:${modName}:mainTab`)
const allTabsChan = new BroadcastChannel(`sf:${modName}:allTabs`)

const queryMessageType = "query"
const queryHandlers: QueryHandlers = {}

const mainTabStatus = new ReactiveAtom<boolean>(false)
let mainTabPromise: Promise<void>
let mainTabPromiseResolve: (reason: any) => void // call to give up main tab status

const isMainTabR = readOnlyReactiveValue(mainTabStatus)
//#endregion

//#region init and state
function init() {
    addListener(async (ev) => {
        switch (ev.type) {
            case "becameMainTab":
                mainTabStatus.set(true)
                break

            case "relinquishedMainTabStatus":
            case "lostMainTabStatus":
                mainTabStatus.set(false)
                break

            case "messageForMainTab":
                const msg = ev.data.message
                if (!messageIsQuery(msg)) return
                await handleQuery(msg, ev.data.fromMainTab)
                break
        }
    })

    //emit events for messages for main canBecomeMainTabtab received via b.c.
    mainTabChan.onmessage = (ev) => {
        if (!isMainTab()) return //other tabs do not receive main tab messages
        events.emitEvent({
            type: "messageForMainTab",
            data: {
                message: ev.data,
                fromMainTab: false
                //if the main tabs sends a message to itself, it is
                //not received over the broadcast channel, therefore
                //fromMainTab must be false here
            }
        })
    }

    //emit events for messages for all tabs received via b.c.
    allTabsChan.onmessage = (ev) => {
        events.emitEvent({
            type: "messageForAllTabs",
            data: { message: ev.data }
        })
    }

    if(!canBecomeMainTab()) return

    //wait for lock to become main tab
    mainTabPromise = new Promise<any>((resolve) => { mainTabPromiseResolve = resolve })
    const lock = navigator.locks.request(mainTabLockName, (l) => {
        events.emitEvent({ type: "becameMainTab", data: {} } as TabEventBecameMainTab)
        return mainTabPromise
    })
    lock.then(val => {
        events.emitEvent({ type: "relinquishedMainTabStatus", data: { reason: val } })
    }).catch(err => {
        events.emitEvent({ type: "lostMainTabStatus", data: { reason: err } })
    })
}

/**
 * Predicate to determine whether this instance of the module can become 
 * a main tab. If it's running within an iframe or a webworker then no.
 */
function canBecomeMainTab() {
    return !(window === undefined || window.self !== window.top || window.document === undefined)
}

function isMainTab() {
    return mainTabStatus.get()
}

/**
 * Checks if a main tab exists. If `relinquishMainTabStatus` is not used in 
 * the code then there is always one main tab unless a `DOMException` has 
 * caused the main tab to lose its lock or all instances of this module are
 * run from within a context where they may not become main tab (see the
 * function `canBecomeMainTab`).
 */
async function mainTabExists(): Promise<boolean> {
    return await navigator.locks.request(mainTabLockName, { ifAvailable: true }, (l) => l === null)
}

/**
 * Voluntariliy give up main tab status. Once called it is not
 * possible for this tab to gain main tab status again unless
 * it reloads.
 * 
 * @returns true if this tab was main tab and is not any longer
 */
function relinquishMainTabStatus(reason: any): boolean {
    if (!isMainTab()) return false
    mainTabPromiseResolve(reason)
    return true
}
//#endregion

//#region messages

/**
 * @throws `NoMainTabError` if no main tab exists
 */
async function postMessageToMainTab<T>(module: string, type: string, content: T) {
    return await postMessageToMainTab0({
        module: module,
        type: type,
        content: content
    })
}

async function postMessageToMainTab0(msg: Message) {
    if (!(await mainTabExists())) throw new NoMainTabError(msg)

    if (isMainTab()) {
        //directly emit as event since main tab would not receive the 
        //message over the broadcast channel mainTabChan
        events.emitEvent({ type: "messageForMainTab", data: { fromMainTab: true, message: msg } })
    } else {
        mainTabChan.postMessage(msg)
    }
}

/**
 * Sends a message to all tabs. Only the main tab tab can do this.
 * @returns true if this tab is main tab and the message was sent
 */
function postMessageToAllTabs(module: string, type: string, content?: any) {
    const msg = { module: module, type: type, content: content }
    return postMessageToAllTabs0(msg, false)
}

/**
 * Same as `postMessageToAllTabs` except that the main tab does 
 * not receive this message when listening to messages for all tabs.
 */
function postMessageToOtherTabs(module: string, type: string, content?: any) {
    const msg = { module: module, type: type, content: content }
    return postMessageToAllTabs0(msg, true)
}

function postMessageToAllTabs0(msg: Message, excludeMainTab: boolean) {
    if (!isMainTab()) return false //only main tab can send messages to all tabs
    if (!excludeMainTab) {
        events.emitEvent({
            type: "messageForAllTabs",
            data: { message: msg }
        })
    }
    allTabsChan.postMessage(msg)
    return true
}
//#endregion

//#region query

/**
 * Sets a handler for queries from a given module and of the given type. 
 * There can only be one handler for each module & type combination.
 * 
 * Main tab query handlers should be set in all tabs during the initialization 
 * phase of a module rather than after a tab becomes a main tab. Otherwise,
 * there might be a time period when the main tab changes and the new one has 
 * not yet finished setting its query handlers and queries will be dropped.
 * 
 * The `revivers` parameter can be used to revive class instances in the query
 * data or response that were sent over the broadcast channel.
 */
function setMainTabQueryHandler<Input, Output>(module: string, type: string, handler: (input: Input) => Promise<Output>, revivers?: Revivers<Input, Output>) {
    if (queryHandlers[module] == undefined) queryHandlers[module] = {}
    queryHandlers[module][type] = {
        handler: handler,
        revivers: revivers ?? {}
    }
}

/**
 * Sends a query to the main tab and returns the response
 * 
 * @throws `NoMainTabError` if no main tab exists
 */
async function queryMainTab<Input, Output>(module: string, type: string, input: Input): Promise<Output> {
    const qh = getQueryHandler(module, type)
    if (qh == null) {
        lg.warn("No main tab query handler set for module '%s' with type '%s' in this browsing context", module, type)
    }
    const outputReviver = qh?.revivers.output

    const id = crypto.randomUUID()
    const msg: Query<Input> = {
        module: modName,
        type: queryMessageType,
        content: {
            module: module,
            type: type,
            id: id,
            data: input
        }
    }

    const p: Promise<Output> = new Promise((resolve, reject) => {
        const lid = addListenerForAllTabs((ev) => {
            //msg must be a query reply due to the filter in addListenerForAllTabs
            //and because query messages sent to all tabs are replies
            const msg = ev.data.message as QueryReply<Output>
            if (msg.content.id != id || msg.content.module != module || msg.content.type != type) return
            if (msg.content.data.ok) {
                let reply = msg.content.data.reply
                if (!isMainTab() && outputReviver) reply = outputReviver(reply)
                resolve(reply)
            } else {
                reject(msg.content.data.exception)
            }
            removeListener(lid)
        }, { module: modName, type: queryMessageType })
    })
    await postMessageToMainTab0(msg)
    return p
}

async function handleQuery(msg: Query<any>, fromMainTab: boolean) {
    const module = msg.content.module
    const type = msg.content.type

    const replyMsg = (data: QueryReply<any>["content"]["data"]): QueryReply<any> => ({
        module: modName,
        type: queryMessageType,
        content: {
            module: module,
            type: type,
            id: msg.content.id,
            data: data
        }
    })

    const qh = getQueryHandler(module, type)
    if (qh == null) {
        const err = new NoQueryHandlerError(module, type)
        lg.impossible("No query handler set for module '%s' with type '%s' (query message: %O)", msg.content.module, msg.content.type, msg)
        postMessageToAllTabs0(replyMsg({ ok: false, exception: err }), false)
        return
    }

    try {
        if (!fromMainTab && qh.revivers.input != undefined)
            msg.content.data = qh.revivers.input(msg.content.data)

        const reply = await qh.handler(msg.content.data)
        postMessageToAllTabs0(replyMsg({ ok: true, reply: reply }), false)
    } catch (e) {
        lg.error("Query handler for for module '%s' with type '%s' threw an exception: %O", msg.content.module, msg.content.type, e)
        postMessageToAllTabs0(replyMsg({ ok: false, exception: e }), false)
    }
}

function getQueryHandler(module: string, type: string) {
    const x = queryHandlers[module]
    return x == undefined ? null : (x[type] ?? null)
}

function messageIsQuery(msg: Message): msg is QueryMessage<any> {
    return msg.module == modName && msg.type == queryMessageType
}
//#endregion

//#region listeners

/**
 * The handler is called whenever a message to the main tab is sent. 
 * This includes the case where the main tab sends a message to itself.
 */
function addListenerForMainTab(handler: EventHandler<TabEventMessageForMainTab>, filter?: { module?: ModuleName, type?: TypeName }) {
    const h: EventHandler<TabEventMessageForMainTab> = (ev) => {
        filter ??= {}
        if (filter.module != undefined && filter.module != ev.data.message.module) return
        if (filter.type != undefined && filter.type != ev.data.message.type) return
        handler(ev)
    }
    return addListener(h, ["messageForMainTab"])
}

/**
 * The handler is called whenever a message to all tabs is sent.
 */
function addListenerForAllTabs(handler: EventHandler<TabEventMessageForAllTabs>, filter?: { module?: ModuleName, type?: TypeName }) {
    const h: EventHandler<TabEventMessageForAllTabs> = (ev) => {
        filter ??= {}
        if (filter.module != undefined && filter.module != ev.data.message.module) return
        if (filter.type != undefined && filter.type != ev.data.message.type) return
        handler(ev)
    }
    return addListener(h, ["messageForAllTabs"])
}

function addListenerForBecomingMainTab(handler: () => any) {
    return addListener(handler, ["becameMainTab"])
}

/**
 * Handler is called when this tab loses or relinquishes main tab status
 */
function addListenerForLosingMainTabStatus(handler: EventHandler<TabEventRelinquishedMainTabStatus | TabEventLostMainTabStatus>) {
    return addListener(handler, ["relinquishedMainTabStatus", "lostMainTabStatus"])
}

//#endregion

class NoQueryHandlerError extends Error {
    readonly module: string
    readonly type: string

    constructor(module: string, type: string) {
        super(`No query handler set for module ${module} and type ${type}`)
        this.name = 'NoQueryHandlerError'
        this.module = module
        this.type = type
    }
}

class NoMainTabError extends Error {
    readonly msg: Message

    constructor(unprocessedMsg: Message) {
        super(`No main tab exists. Message ${JSON.stringify(unprocessedMsg)} could not be processed`)
        this.name = 'NoMainTabError'
        this.msg = unprocessedMsg
    }
}