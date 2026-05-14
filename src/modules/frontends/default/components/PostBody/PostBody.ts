export { PostBody, modName, init }

import { darkModeEnabled, mainSettings, preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"

import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { parseTotal } from "../../../../backend/parser/parser.js"
import { renderMath } from "../../../../libs/etc/mathjax.js"
import { renderCode } from "../../../../libs/etc/highlight.js"

import { onChange } from "../../../../libs/basic/reactive.js"

const modName = "PostBody"
const lg = new DefaultLogger(modName)
const tmpl = (name: string, data: any) => tmpl0("components/PostBody/" + name, data, preferredTmpl())

function init() {
    customElements.define(PostBody.tagName, PostBody)
}

class PostBody extends HTMLElement {
    static readonly tagName = "sfc-post-body"

    #shadow: ShadowRoot
    readonly #ui = {
        cssLight: () => this.#shadow.getElementById("cssLight") as HTMLLinkElement,
        cssDark: () => this.#shadow.getElementById("cssDark") as HTMLLinkElement,

        math: () => Array.from(this.#shadow.querySelectorAll<HTMLElement>(".math")),
        code: () => Array.from(this.#shadow.querySelectorAll<HTMLElement>("code")),
        spoiler: () => Array.from(this.#shadow.querySelectorAll<HTMLElement>(".spoiler")),
    }
    content: string

    constructor(content: string) {
        super()
        this.#shadow = this.attachShadow({ mode: "open" })
        this.content = content
        this.setContent(this.content)
    }

    setContent(content: string) {
        this.content = content
        const ast = parseTotal(this.content)
        const tmplData = { ast: ast }
        lg.debug("AST", tmplData)

        this.#shadow.innerHTML = tmpl("body.html", tmplData)

        //Array.from(this.querySelectorAll(".math")).forEach(x => renderMath(x as HTMLElement))
        //Array.from(this.querySelectorAll("code")).forEach(x => renderCode(x))
        // this.querySelectorAll(".spoiler").forEach(el =>
        //     el.addEventListener("click", ev => this.#spoilerAction(ev), { capture: true })
        // )

        this.#ui.math().forEach(x => renderMath(x))
        this.#ui.code().forEach(x => renderCode(x))
        this.#ui.spoiler().forEach(el =>
            el.addEventListener("click", ev => this.#spoilerAction(ev), { capture: true })
        )

        onChange(mainSettings.colorScheme, () => {
            this.#ui.cssLight().disabled = darkModeEnabled()
            this.#ui.cssDark().disabled = !darkModeEnabled()
        })

    }

    //uncover first spoilered parent containing the event target
    //if target has been reached and 
    #spoilerAction(ev: Event) {
        //first ancestor of target (including target) that contains spoiler class
        const f0 = (x: HTMLElement): HTMLElement =>
            x.classList.contains("spoiler") ? x
                : (x.parentElement == null ? x : f0(x.parentElement))

        const el = ev.currentTarget as HTMLElement
        const spoilerTarget = f0(ev.target as HTMLElement)

        //don't react if user selected text
        if (this.#hasSelectedTextIn(el)) return

        //uncover if spoilered
        if (el.classList.contains("spoiler-on")) {
            el.classList.remove("spoiler-on")
            el.classList.add("spoiler-off")
            ev.stopPropagation()
            return
        }

        //if everything is unspoilered and spoiler target is reached, spoiler it again
        if (spoilerTarget === el && el.classList.contains("spoiler-off")) {
            lg.debug("REACH TARGET")
            el.classList.remove("spoiler-off")
            el.classList.add("spoiler-on")
        }

    }

    #hasSelectedTextIn(el: HTMLElement) {
        const sel = window.getSelection()
        return sel !== null && el.contains(sel.anchorNode) && !sel.isCollapsed
    }

}

init()