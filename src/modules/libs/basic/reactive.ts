//#region import/export
export {
    ReactiveValue, ReactiveWritableValue, ReactiveSyncWritableValue, ReactiveAsyncWritableValue,
    ReactiveAtom, ThrottleReactiveValue,
    ReactiveAtomEvent,
    BindToOptions, UpdateFromOptions,
    RemovableListenerId,
    onChange,
    bindTo, bindToInnerHtml, bindToTextContent, bindToValue, bindToChecked,
    updateFromValue, updateFromChecked,
    reactiveExpression, readOnlyReactiveValue, reactiveInput, reactiveCheckbox
}

import { EventEmitter, RemovableListenerId, Events } from "./events.js"
//#endregion

//#region types
/**
 * Since `get()` may pass a reference to the underlying value, it should not
 * be modified, e.g. by setting properties or calling push on an array.
 * In such a case use `structuredClone()` on the returned value first.
 */
type ReactiveValue<T> = {
    get: () => T,
    onChange: (f: (newValue: T) => void | Promise<void>) => RemovableListenerId[]
}

type ReactiveWritableValue<T> = ReactiveSyncWritableValue<T> | ReactiveAsyncWritableValue<T>
type ReactiveSyncWritableValue<T> = ReactiveWritableValue0<T, void>
type ReactiveAsyncWritableValue<T> = ReactiveWritableValue0<T, Promise<void>>
type ReactiveWritableValue0<T, R extends void | Promise<void>> = ReactiveValue<T> & {
    set: (x: T) => R
}

type HTMLUserInputElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

type BindToOptions<T> = {
    converter?: (val: T) => any,
    afterUpdate?: AfterUpdateF<T>,
    onFail?: OnFailF<T>
}

type UpdateFromOptions<T> = {
    updateEvent?: "change" | "input",
    callbackOnInvalidInput?: CallbackOnInvalidInput<T>,
    listenerOptions?: boolean | AddEventListenerOptions
}

type AfterUpdateF<T> =
    (newValue: any, rv: ReactiveValue<T>, obj: any, prop: string) => void | Promise<void>

type OnFailF<T> =
    (e: any, rv: ReactiveValue<T>, obj: any, prop: string) => void | Promise<void>

type CallbackOnInvalidInput<T> =
    (val: any, rwv: ReactiveSyncWritableValue<T>, err: any) => void | Promise<void>

type UnboxReactiveValues<Tuple extends [...ReactiveValue<any>[]]> = {
    [Index in keyof Tuple]: UnboxReactiveValue<Tuple[Index]>
}
type UnboxReactiveValue<T extends ReactiveValue<any>> = T extends ReactiveValue<infer S> ? S : never

//#endregion

//#region events
type ReactiveAtomEvent<T> = ReactiveAtomEventUpdate<T>
type ReactiveAtomEventUpdate<T> = {
    type: "update",
    time: Date,
    data: T
}
//#endregion

//#region functions

/**
 * In contrast to `rv.onChange` this function also calls `f` for initialization.
 * Should be preferred over `rv.onChange` in most cases.
 */
function onChange<T>(rv: ReactiveValue<T>, f: (nv: T) => void | Promise<void>): RemovableListenerId[] {
    const errMsg = "onChange initialization failed for reactive value %O: %O"
    const rlids = rv.onChange(f)

    try {
        //initial call 
        const x = f(rv.get())
        if (x instanceof Promise) {
            x.catch((e) => console.error(errMsg, rv, e))
        }
    } catch (e) {
        console.error(errMsg, rv, e)
    } finally {
        return rlids
    }
}

/**
 * Automatically update `obj[prop]` to `rv` whenever it changes.
 * 
 * @param options.converter use to convert value of `rv` to be suitable for assignment to `obj[prop]`; default is identity
 * @param options.afterUpdate is called after `obj[prop]` has been updated
 * @param options.onFail called if `converter` or `afterUpdate` throws an error or rejected
 */
function bindTo<T>(rv: ReactiveValue<T>, obj: any, prop: string, options?: BindToOptions<T>) {
    const converter = options?.converter ?? (x => x)
    const afterUpdate = options?.afterUpdate ?? (() => { })
    const onFail = options?.onFail ?? ((e, rv, obj, prop) => { console.error("converter or afterUpdate failed for reactive value %O, obj %O and property %s: %O", rv, obj, prop, e) })

    const f = (nv: T) => {
        try {
            const cv = converter(nv)
            obj[prop] = cv
            afterUpdate(cv, rv, obj, prop)
        } catch (e) {
            onFail(e, rv, obj, prop)
        }
    }
    return onChange(rv, f)
}

/**
 * Binds `rv` to `el.innerHTML`
 * 
 * @param afterUpdate e.g. use to add listeners after HTML has been rerendered
 */
function bindToInnerHtml<T>(rv: ReactiveValue<T>, el: HTMLElement, options?: BindToOptions<T>) {
    return bindTo<T>(rv, el, "innerHTML", options)
}

/**
 * Binds `rv` to `el.textContent` (`rv` is HTML escaped)
 */
function bindToTextContent<T, P>(rv: ReactiveValue<T>, el: Node, options?: BindToOptions<T>) {
    return bindTo(rv, el, "textContent", options)
}

/**
 * Binds `rv` to `el.value`
 */
function bindToValue<T>(rv: ReactiveValue<T>, el: HTMLUserInputElement, options?: BindToOptions<T>) {
    return bindTo(rv, el, "value", options)
}

/**
 * Binds `rv` to `el.value`
 */
function bindToChecked<T>(rv: ReactiveValue<T>, el: HTMLInputElement, options?: BindToOptions<T>) {
    return bindTo(rv, el, "checked", options)
}

/**
 * Updates value of `rwv` whenever the value of `el` changes to `converter(el.value)`
 */
function updateFromValue<T>(rwv: ReactiveWritableValue<T>, el: HTMLUserInputElement,
    converter: (val: string) => T, options?: UpdateFromOptions<T>) {
    const updateEvent = options?.updateEvent ?? "change"
    const callbackOnInvalidInput = options?.callbackOnInvalidInput ?? ((val: any, err: any) => { })

    el.addEventListener(updateEvent, async (ev) => {
        try {
            await rwv.set(converter(el.value))
        } catch (e) {
            callbackOnInvalidInput(el.value, rwv, e)
        }
    }, options?.listenerOptions)
}

function updateFromChecked(rwv: ReactiveWritableValue<boolean>, el: HTMLInputElement,
    options?: boolean | AddEventListenerOptions) {
    el.addEventListener("change", async (ev) => await rwv.set(el.checked), options)
}

/**
 * Converts a function `fn` with reactive values from `arr` as arguments to a reactive value.
 * 
 * @param rvs reactive values whose values are passed to `fn`
 */
function reactiveExpression<Input extends [...ReactiveValue<any>[]], Output>(rvs: [...Input], fn: (...args: [...UnboxReactiveValues<Input>]) => Output): ReactiveValue<Output> {
    const get = () => fn(...rvs.map(x => x.get()) as [...UnboxReactiveValues<Input>])
    return {
        get: get,
        onChange: (f: (newValue: Output) => void) => rvs.flatMap((rv) => rv.onChange(() => f(get())))
    }
}

function reactiveInput(el: HTMLUserInputElement, event?: "change" | "input"): ReactiveSyncWritableValue<string> {
    event ??= "change"
    const x = new ReactiveAtom(el.value)
    el.addEventListener(event, () => x.set(el.value))
    x.onChange((nv) => el.value = nv)
    return x
}

function reactiveCheckbox(el: HTMLInputElement): ReactiveSyncWritableValue<boolean> {
    const x = new ReactiveAtom(el.checked)
    el.addEventListener("change", () => x.set(el.checked))
    x.onChange((nv) => el.checked = nv)
    return x
}

function readOnlyReactiveValue<T>(rwv: ReactiveWritableValue<T>): ReactiveValue<T> {
    return {
        get: rwv.get.bind(rwv),
        onChange: rwv.onChange.bind(rwv)
    }
}

//#endregion

/**
 * Basic implementation of a ReactiveWritableValue
 */
class ReactiveAtom<T> implements ReactiveSyncWritableValue<T>, EventEmitter<ReactiveAtomEvent<T>> {
    #value: T
    #isEquivalent: (oldVal: any, curVal: any) => boolean
    // why not T instead of any? because it causes type narrowing for string literals
    // to fail (e.g. see export.ts for an example where it fails)
    readonly #events
    readonly addListener
    readonly removeListener

    /**
     * @param checkEquivalence `false` by default; if true then onChange listeners are
     * only called if the value that has been set differs from the old one w.r.t. their
     * JSON representation (only use this for primitives such as boolean, number and string).
     * Alternatively, a custom equivalence function can be passed to determine if a new value
     * differs from the current one; it should return true for values that are considered
     * equivalent.
     */
    constructor(initialValue: T, checkEquivalence?: boolean | ((x: T, y: T) => boolean)) {
        this.#value = initialValue

        checkEquivalence ??= false
        if (checkEquivalence === false) {
            this.#isEquivalent = (x, y) => false
        } else if (checkEquivalence === true) {
            this.#isEquivalent = (x, y) => JSON.stringify(x) == JSON.stringify(y)
        } else {
            this.#isEquivalent = checkEquivalence
        }
        
        this.#events = new Events<ReactiveAtomEvent<T>>()
        this.addListener = this.#events.export().addListener
        this.removeListener = this.#events.export().removeListener
    }

    get() {
        return this.#value
    }

    set(value: T) {        
        if (this.#isEquivalent(this.#value, value)) return
        this.#value = value
        this.#events.emitEvent({
            type: "update",
            data: this.#value
        } as ReactiveAtomEventUpdate<T>)
    }

    onChange(f: (newValue: T) => void) {
        return [{
            listenerId: this.addListener((ev) => f(ev.data), ["update"]),
            removeListener: this.removeListener
        }]
    }
}

/**
 * Transforms a reactive value into a throttled one that calls its
 * `onChange` handlers at most once every `throttlePeriod` ms. If a 
 * change occurs less than `throttlePeriod` ms after the last one then
 * a timer is set so that the handlers are called after the remainder
 * of the throttle period has passed. 
 * 
 * If multiple changes occur during the throttle period only the last 
 * value will be used when calling the `onChange` handlers.
 */
class ThrottleReactiveValue<T> {
    readonly throttlePeriod: number
    readonly #throttledRv: ReactiveAtom<T>
    #lastUpdate: number // timestamp
    #cachedValue: T
    #intervalId?: number //undefined => no timer running

    /**
     * @param throttlePeriod in ms
     */
    constructor(rv: ReactiveValue<T>, throttlePeriod: number) {
        this.throttlePeriod = throttlePeriod

        const val = rv.get()
        this.#throttledRv = new ReactiveAtom<T>(val)
        this.#cachedValue = val
        this.#lastUpdate = 0
        this.#intervalId = 0

        rv.onChange(this.#onChange.bind(this))
    }

    #onChange(newValue: T) {
        const now = Date.now()
        const timeSinceLastUpdate = now - this.#lastUpdate
        this.#cachedValue = newValue

        if (timeSinceLastUpdate > this.throttlePeriod) {
            //throttle interval has passed since last change
            this.#update()
            return
        }

        //set timer for next update unless it is already set
        if (this.#intervalId == undefined) {
            this.#intervalId = setTimeout(this.#update.bind(this),
                this.throttlePeriod - timeSinceLastUpdate)
        }
    }

    #update() {
        this.#throttledRv.set(this.#cachedValue)
        this.#lastUpdate = Date.now()
        if (this.#intervalId != undefined) {
            //clear timer from previous change
            clearTimeout(this.#intervalId)
            this.#intervalId = undefined
        }
    }

    throttled(): ReactiveValue<T> {
        return this.#throttledRv
    }
}