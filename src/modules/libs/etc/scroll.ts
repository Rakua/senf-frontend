export { ScrollRecorder, getLastScrollPosition, scrollPosition }

import { DefaultLogger } from "../basic/logger.js"
import { onChange, ReactiveAtom, ThrottleReactiveValue } from "../basic/reactive.js"
import { currentNaviPath, NaviPath } from "./router.js"

type ScrollPosition = { x: number, y: number }

const modName = "scroll"
const lg = new DefaultLogger(modName)

/**
 * Returns the last scroll position the user had on the current page
 * from the history state
 */
function getLastScrollPosition(): ScrollPosition {
    lg.debug("getLastScrollPosition: %O", history.state)
    return history.state?.scrollPosition ?? { x: 0, y: 0 }
}

function scrollPosition() {
    return { x: window.scrollX, y: window.scrollY }
}

class ScrollRecorder {
    readonly recorderFor: NaviPath

    #scrollPosRv
    #throttledScrollPosRv
    #rlid
    #listener = () => this.#scrollPosRv.set(scrollPosition())

    /**
     * Starts recording the scroll position for the given path by listening to 
     * scroll events and writes it to the history state if the current navi
     * path equals the parameter `path`.
     *
     * @param throttleMs throttle processing of the scroll events; defaults to 100
     */
    constructor(path: NaviPath, throttleMs?: number) {
        throttleMs ??= 100
        this.recorderFor = path

        this.#scrollPosRv = new ReactiveAtom<ScrollPosition>(scrollPosition())
        this.#throttledScrollPosRv = new ThrottleReactiveValue(this.#scrollPosRv, throttleMs).throttled()

        // lg.debug("start recording for %s", path.toFragmentId())
        window.addEventListener("scroll", this.#listener)
        this.#rlid = onChange(this.#throttledScrollPosRv, pos => {
            if (currentNaviPath().toFragmentId() === this.recorderFor.toFragmentId()) {
                // lg.debug("new scroll pos %O for %s", pos, path.toFragmentId())
                const newState = { ...history.state, scrollPosition: pos }
                history.replaceState(newState, "")
            }
        })
    }

    /**
     * Stops the recorder. Call after the site has navigated to a new path.
     */
    stopRecording() {
        lg.debug("stop recording (%s != %s)", currentNaviPath().toFragmentId(), this.recorderFor.toFragmentId())
        window.removeEventListener("scroll", this.#listener)
        this.#rlid.forEach(x => x.removeListener(x.listenerId))
    }
}


/**
 * Dev note:
 * 
 * Instead of continously recording the scroll position, it would suffice if the
 * scroll position of a page is remember before the app renders the next page
 * on a navigation event. That information would have to be stored in the session
 * storage because it could not be associated with the correct history state entry
 * (when the navigation event occurs `history.state` already refers to the state
 * of the new page).
 * 
 */