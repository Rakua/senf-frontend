/*
There are the following types of navigations:
(1) in app navigation
    (1a) across pages: `navigateTo`
    - app instance creates new Page instance and binds it to DOM
    (1b) within page: `navigateWithinPage`
    - page instance handles change of page contents
(2) browser function back or forward
(3) manual URL change by user (e.g. changes URL in address bar and hits enter)
(4) page reload (e.g. F5 in browser)

If the app uses links (e.g. <a href="#page=somePage">) for navigation within
the app, make sure to apply `toRoutedLink` to these elements. This ensures
that they are treated as case (1) instead of (3).

A hashchange DOM event is triggered by (1a), (2) and (3).

*** Important ***: whenever a navigation via `navigateTo` or `navigateWithinPage` 
is not triggered via a user interaction it might be appropriate to set the auto 
flag to prevent the browser's back navigation to be trapped. See the comment
at `let autoFlag`.
*/

//#region import/export
export {
    modName, separatorToken,
    NaviPath, init, currentNaviPath, navigateTo, navigateWithinPage, navigateToAndReload, refresh, rewriteNaviPath, toRoutedLink,
    RouterEvent, RouterEventNavigation as RouterEventPathChanged, addListener, removeListener
}

import { Events } from "../basic/events.js"
import { DefaultLogger } from "../basic/logger.js"
import { fromJson, isNumber, toJson } from "../basic/misc.js"
import { ReactiveSyncWritableValue } from "../basic/reactive.js"
//#endregion

//#region events
type RouterEvent = RouterEventNavigation

type RouterEventNavigation = {
    type: "navigation",
    data: {
        oldPath: NaviPath,
        newPath: NaviPath,
        inApp: boolean,
        withinPage: boolean,
        auto: boolean
    }
}

//#endregion

type ParameterValue = string | number | Object | undefined

const modName = "router"
const pageParamName = "page"
const equalsToken = "="
const separatorToken = "&"
const lg = new DefaultLogger(modName)

const events = new Events<RouterEvent>()
const addListener = events.export().addListener
const removeListener = events.export().removeListener

/**
 * Used to determine if `navigateTo` was called or a hashchange
 * event was caused by some other kind of interaction.
 */
let inAppNaviFlag = false

/**
 * Used to determine if the navigation was not caused by a user 
 * interaction but automatically. When the user navigates back
 * all history entries (pages that the user was navigated away
 * from automatically) are skipped.
 * 
 * The purpose is to prevent an infinite loop when the user try
 * to navigate back. For example, consider the following scenario:
 * 
 * (1) user starts on page A (`"#page=A"`)
 * (2) user navigates to page B (`"#page=B"`)
 * (3) page B sets some query parameters from the user's settings 
 *     as soon as it is loaded (`#page=B&q=123`) via `navigateWithinPage`
 *     to trigger a reaction in the corresponding component
 * (4) user clicks back
 * 
 * If page B would not set the auto flag then the user would be taken
 * back to `"#page=B"` and the script automatically takes the user back
 * to `#page=B&q=123` causing the back navigation to be trapped in this
 * infinite loop. Instead, the user should be taken back to page A.
 * By setting the `auto` flag in (3)'s call to `navigateWithinPage` this
 * can be achieved. 
 */
let autoFlag = false

function init() {
    window.addEventListener("hashchange", (ev: HashChangeEvent) => {
        if (inAppNaviFlag == false && history.state?.routerAuto === true) {
            //not in app navigation and current navigation to this
            //history state was not caused by a user interaction then 
            //go back further
            history.back()
        }

        const oldNp = NaviPath.fromFragmentId(getFragmentId(ev.oldURL))
        const newNp = NaviPath.fromFragmentId(getFragmentId(ev.newURL))
        events.emitEvent({
            type: "navigation",
            data: {
                oldPath: oldNp,
                newPath: newNp,
                inApp: inAppNaviFlag,
                withinPage: false,
                auto: autoFlag
            }
        })
        autoFlag = false
        inAppNaviFlag = false
    })
}

/**
 * Prevents the default browser behavior when a link is clicked and calls 
 * `navigateTo()`, `replaceNaviPath()` or `refresh()` instead using the
 * hash fragment from the `href` attribute.
 * 
 * The parameter `samePathCallback` will be called if the target fragment
 * id does not differ from the current one. For instance, this can be used 
 * to trigger a refresh.
 * 
 * Applying this function to anchor elements ensures that all in-app 
 * navigation causes a `RouterEvent`.
 */
function toRoutedLink(aEl: HTMLAnchorElement, mode: "navigateTo" | "navigateWithinPage" | "refresh", samePathCallback?: () => void) {
    samePathCallback ??= () => { }

    aEl.addEventListener("click", (ev) => {
        ev.preventDefault()
        const np = NaviPath.fromFragmentId(new URL(aEl.href).hash)
        switch (mode) {
            case "navigateTo":
                if (!navigateTo(np)) samePathCallback()
                return
            case "navigateWithinPage":
                if (!navigateWithinPage(np)) samePathCallback()
                return
            case "refresh":
                refresh()
                return
        }
    })
}

function currentNaviPath(): NaviPath {
    if (window.location.hash == "") return new NaviPath()
    return NaviPath.fromFragmentId(window.location.hash.slice(1))
}

/** 
 * Use to navigate between pages.
 * 
 * Causes the `App` instance to create a new instance of the page
 * class corresponding to the given path and render it.
 * 
 * Has no effect if the user is already at the given path.
 * 
 * @param auto set to true if the navigation was not caused by a user interaction
 * @returns true iff `path` differs from current path and thus a navigation occurs
 */
function navigateTo(path: NaviPath, auto?: boolean) {
    auto ??= false
    if (path.toFragmentId() == currentNaviPath().toFragmentId()) return false

    inAppNaviFlag = true
    if (auto) {
        autoFlag = true
        addAutoFlagToHistory()
    }

    location.assign(path.toFragmentId())
    return true
}

/**
 * Use for navigation within a page, e.g. changing a tab or a 
 * page in a paginated component. 
 * 
 * Has no effect if the user is already at the given path.
 * 
 * @param auto set to true if the navigation was not caused by a user interaction
 * @returns true iff `path` differs from current path and thus a navigation occurs
 */
function navigateWithinPage(path: NaviPath, auto?: boolean) {
    if (path.toFragmentId() == currentNaviPath().toFragmentId()) return false

    auto ??= false
    if (auto) addAutoFlagToHistory()

    const oldPath = currentNaviPath()
    history.pushState(null, "", document.location.pathname + path.toFragmentId())
    events.emitEvent({
        type: "navigation",
        data: {
            oldPath: oldPath,
            newPath: path,
            inApp: true,
            withinPage: true,
            auto: auto
        }
    })
    return true
}

/**
 * Emits a navigation event that tells the app to reload the current page.
 * 
 * @param auto set to true if the refresh was not caused by a user interaction
 */
function refresh(auto?: boolean) {
    auto ??= false

    events.emitEvent({
        type: "navigation",
        data: {
            oldPath: currentNaviPath(),
            newPath: currentNaviPath(),
            inApp: true,
            withinPage: false,
            auto: auto
        }
    })
}

/**
 * This will rewrite the current navi path to the given one and
 * cause the browser to reload the page.
 */
function navigateToAndReload(path: NaviPath) {
    rewriteNaviPath(path)
    location.reload()
}

/**
 * Use to set an invalid or omitted parameter in the URL to its
 * actual default value without affecting the history and without
 * triggering a RouterEvent.
 */
function rewriteNaviPath(path: NaviPath) {
    history.replaceState({ fromHistory: true }, "", document.location.pathname + path.toFragmentId())
}

function getFragmentId(url: string): string {
    return new URL(url).hash.slice(1)
}

function addAutoFlagToHistory() {
    history.replaceState({ ...history.state, routerAuto: true }, "")
}

/**
 * Parameters that are encoded in the fragment identifier
 */
class NaviPath<Parameter extends string = string> {
    #data: { [key: string]: string | number | Object }

    constructor(pageName?: string) {
        this.#data = {}
        if (pageName !== undefined) this.setPage(pageName)
    }

    has(key: Parameter) {
        return this.#data[key] !== undefined
    }

    /**
     * @param excludePage excludes page parameter if true; false by default
     * @returns array of parameter keys that are set
     */
    parameters(excludePage?: boolean) {
        excludePage ??= false
        let x = Object.keys(this.#data)
        if (excludePage) x = x.filter(y => y != pageParamName)
        return x
    }

    get(key: Parameter): ParameterValue {
        return this.#data[key]
    }

    /**
     * Turns the URL parameter with the given key into a reactive writable
     * value. When it is set and the given value differs from the current
     * one in the URL, a navigation within the page is triggered.
     */
    reactive(key: Parameter): ReactiveSyncWritableValue<ParameterValue> {
        const rwv: ReactiveSyncWritableValue<ParameterValue> = {
            get: () => this.get(key),
            onChange: (f) => {
                return [{
                    listenerId: addListener((ev) => {
                        const nv = ev.data.newPath.get(key)
                        const ov = ev.data.oldPath.get(key)
                        if (toJson(nv) == toJson(ov)) return
                        f(nv)
                    }),
                    removeListener: removeListener
                }]
            },
            set: (x: ParameterValue) => {
                const cnp = currentNaviPath()
                if (x === undefined) {
                    if (cnp.has(key)) {
                        navigateWithinPage(currentNaviPath().unset(key))
                    }
                } else {
                    if (toJson(x) !== cnp.get(key)) {
                        navigateWithinPage(cnp.set(key, x))
                    }
                }
            }
        }

        return rwv
    }

    set(key: Parameter, value: NonNullable<ParameterValue>) {
        if ((key as string).includes(separatorToken)) throw new Error("navi path parameter key cannot contain separator token '" + separatorToken + "': " + key)
        if ((key as string).includes(equalsToken)) throw new Error("navi path parameter key cannot contain equals token '" + equalsToken + "': " + key)
        this.#data[key] = value
        return this
    }

    unset(key: Parameter) {
        delete this.#data[key]
        return this
    }

    hasPage(): boolean {
        return this.#data[pageParamName] !== undefined
    }

    getPage(): string | undefined {
        return this.#data[pageParamName] as string | undefined
    }

    setPage(pageName: string) {
        this.#data[pageParamName] = pageName
    }

    /**
     * @returns fragment id with leading '#'
     */
    toFragmentId(): string {
        let res = "#"
        for (const key of Object.keys(this.#data)) {
            if (res !== "#") res += separatorToken
            res += key + equalsToken
            const val = this.#data[key]
            if (typeof val == "string" || typeof val == "number") {
                res += encodeURIComponent(val)
            } else {
                res += encodeURIComponent(JSON.stringify(val))
            }
        }

        return res
    }

    /**
     * If a parameter value starts with '{' or '[' it is assumed to 
     * be a JSON object. If a parameter value is a number then it will
     * be converted to a number. Otherwise, a value is treated as
     * string.
     * 
     * @param fragmentId with or without leading '#'
     * @returns `NaviPath` object constructed from `fragmentId`
     */
    static fromFragmentId(fragmentId: string) {
        //normalize fragment id by removing leading '#'
        if (fragmentId.startsWith("#")) fragmentId = fragmentId.slice(1)

        const np = new NaviPath()
        if (fragmentId === "") return np //empty navi path

        //separator token cannot occur in parameter values since encodeURIComponent escapes it
        const parts = fragmentId.split(separatorToken)
        for (const part of parts) {
            const x = part.split(equalsToken)
            if (x.length == 1) {
                lg.error("missing '%s' in part of fragment id, ignoring it (%s)", equalsToken, JSON.stringify(part))
                continue
            }
            if (x.length > 2) {
                lg.error("more than one '%s' in part %s of fragment id (ignoring it)", equalsToken, JSON.stringify(part))
                continue
            }
            const key = x[0]
            try {
                let value = decodeURIComponent(x[1])
                if (value[0] == "{" || value[0] == "[") {
                    np.set(key, fromJson(value))
                } else if (isNumber(value)) {
                    np.set(key, Number(value))
                } else {
                    np.set(key, value)
                }
            } catch (e) {
                lg.error("failed to parse part %s of fragment id (ignoring it): %O", JSON.stringify(part), e)
            }
        }

        return np
    }
}
