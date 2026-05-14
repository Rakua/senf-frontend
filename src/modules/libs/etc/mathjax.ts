export { modName, init, render as renderMath, hasLoaded, mathJaxConfig }

import { DefaultLogger } from "../basic/logger.js"

const modName = "mathjax"
const lg = new DefaultLogger(modName)
let initDone = false

let mathJaxLoaded: boolean = false
const hasLoaded = () => mathJaxLoaded

let renderQueue: HTMLElement[] = []
let renderPromise = Promise.resolve() //use to wait until previous rendering has finished

//#region MathJax config
// https://docs.mathjax.org/en/latest/options
declare global {
    interface Window {
        MathJax: any
    }
}

const mathJaxConfig = {
    startup: {
        typeset: false,
        ready: initAfterMathJaxLoaded
    },
    loader: {
        //load: ["input/tex-full", "output/chtml", "output/svg", "ui/safe"]
        load: ["input/tex-full", "output/svg", "ui/safe"]
    },
    options: {
        //https://docs.mathjax.org/en/latest/options/safe.html#safe-options 
        safeOptions: {
            allow: {
                URLs: 'none',   // safe are in safeProtocols below
                classes: 'safe',   // safe start with mjx- (can be set by pattern below)
                cssIDs: 'safe',   // safe start with mjx- (can be set by pattern below)
                styles: 'safe'    // safe are in safeStyles below
            },
            safeProtocols: {
                http: false,
                https: false,
                file: false,
                javascript: false,
                data: false
            },
        },
    }
}

window.MathJax = mathJaxConfig
//#endregion

//#region functions
function init() {
    initDone = true
    lg.log("mathjax init done")
}

function initAfterMathJaxLoaded() {
    lg.log("initAfterMathJaxLoaded()")
    //check that init was called
    if (!initDone) {
        lg.log("mathjax:init() not finished yet, will call initAfterMathJaxLoaded again later")
        setTimeout(initAfterMathJaxLoaded, 20)
        return
    }

    window.MathJax.startup.defaultReady()
    //https://github.com/mathjax/MathJax/issues/2312#issuecomment-2440036455
    //https://github.com/mathjax/MathJax/issues/2312#issuecomment-2440775586
    window.MathJax.startup.document.inputJax[0].preFilters.add(({ math }: any) => {
        if (math.math.match(/\\\\/))
            math.math = `\\displaylines{${math.math}}`
        //if (math.math.match(/\\\\/) && !math.math.match(/\\begin\{/))  // does not work

    })

    mathJaxLoaded = true
    lg.log("MathJax loaded")

    //initial rendering    
    render()
}

function render(element?: HTMLElement) {
    if (element !== undefined) renderQueue.push(element)
    if (!mathJaxLoaded) return

    while (true) {
        const el = renderQueue.shift()
        if (el === undefined) break

        const options = { display: window.getComputedStyle(el).display == "block" }

        //todo: add option to use chtml renderer
        //todo: add assitive tech & context menu?

        renderPromise = renderPromise.then(() =>
            window.MathJax.tex2svgPromise(el.textContent, options)
                .then((mathDom: any) => {
                    lg.debug("REPLACE WITH %O", mathDom)
                    el.replaceChildren(mathDom)
                })
                .catch((err: Error) => lg.error("failed to render: %O", err))
        )
    }

}
//#endregion