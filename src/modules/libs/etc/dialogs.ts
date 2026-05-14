export { init, watchDialogs }

import { DefaultLogger } from "../basic/logger.js"
import { ReactiveAtom } from "../basic/reactive.js"
import { addListener as addRouterListener } from "./router.js"

const modName = "dialogs"
const dialogsOpened = new ReactiveAtom(0)
const className_dialogOpen = "dialogOpen"

const lg = new DefaultLogger(modName)

function init() {
    dialogsOpened.onChange(nv => {
        lg.debug("# of dialogs open: %O", nv)
        if (nv == 0) {
            document.body.classList.remove(className_dialogOpen)
        } else {
            document.body.classList.add(className_dialogOpen)
        }
    })

    //todo: bug
    hotfix()
}

/**
 * Watches whether a dialog inside rootNode is opened or closed. If at
 * If at least one dialog is open it adds the class `dialogOpen` to 
 * `<body>` and if not it removes it. This can be used to prevent page
 * scrolling when a dialog is open. Every dialog should have its own 
 * scroll bar if it exceeds the viewports height (otherwise it cannot
 * be scrolled).
 * 
 * Call this function for every custom element which uses `<dialog>`s
 * with their shadow DOM as rootNode. Whenever at least one dialog is open,
 * this will add a class `dialogOpen` to `<body>` and when all dialogs
 * are closed.
 * 
 * Before removing a custom element with possibly open dialogs, call 
 * `this.#shadow.querySelectorAll("dialog").forEach(el => el.close())`.
 * Put this in the `disconnectedCallback()`.
 *  
 * @param rootNode 
 */
function watchDialogs(rootNode: Node) {
    const observer = new MutationObserver((ml) => {
        for (const x of ml) {
            if (!(x.target instanceof HTMLDialogElement)) continue

            if (x.target.open) {
                dialogsOpened.set(dialogsOpened.get() + 1)
            } else {
                dialogsOpened.set(dialogsOpened.get() - 1)
            }
        }
    })

    observer.observe(rootNode, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ["open"]
    })
}

/**
 * There is a bug that causes the body to not be scrollable despite
 * all dialogs being closed. Why?
 * - a dialog might be counted twice when it is opened?
 * - a dialog is not counted when it is closed (more likely)
 * - a DOM modification causes watchDialogs to miscount?
 * 
 * This function causes the dialog counter to be reset to 0 after
 * every page navigation. This enables the user to restore 
 * scrollability by navigating away from a page and back again.
 */
function hotfix() {
    addRouterListener((ev) => {
        if (!ev.data.withinPage) dialogsOpened.set(0)
    })
}