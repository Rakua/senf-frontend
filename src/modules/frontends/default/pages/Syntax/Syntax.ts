//#region import/export
export { SyntaxPage, modName }

import { tmpl as tmpl0 } from "../../tmpl.js"
import { preferredTmpl } from "../../../../../config.js"
import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { reactiveExpression, reactiveCheckbox, reactiveInput } from "../../../../libs/basic/reactive.js"
import { PostBody } from "../../../default/components/PostBody/PostBody.js"
import { InputError, inputErrorMessage, isInputError, parse, PegSyntaxError, removeCommands, replaceAliasesInUriTags } from "../../../../backend/parser/parser.js"
import hljs from "../../../../libs/highlight/highlight.js"
import { ExposedPromise } from "../../../../libs/basic/misc.js"

//#endregion

const modName = "SyntaxPage"
const tmpl = (name: string, data: any) => tmpl0("pages/Syntax/" + name, data, preferredTmpl())
const lg = new DefaultLogger(modName)

function init() {
    customElements.define(SyntaxPage.tagName, SyntaxPage)
}

class SyntaxPage extends HTMLElement {
    static readonly pageName = "syntax"
    static readonly tagName = "sf-syntax"

    #contentLoaded = new ExposedPromise<void>()
    readonly initialContentLoaded = this.#contentLoaded.promise

    #shadow: ShadowRoot
    readonly #ui = {
        body: () => this.#shadow.getElementById("body") as HTMLTextAreaElement,
        preview: () => this.#shadow.getElementById("preview") as HTMLDivElement,
        syntaxEnabled: () => this.#shadow.getElementById("syntaxEnabled") as HTMLInputElement,

        examplesLink: () => this.#shadow.getElementById("examplesLink") as HTMLAnchorElement,
        grammarLink: () => this.#shadow.getElementById("grammarLink") as HTMLAnchorElement,
        syntaxLink: () => this.#shadow.getElementById("syntaxLink") as HTMLAnchorElement
    }    

    #insertedSectionSign: boolean = false

    //body is escaped if syntax is disabled, otherwise its value is returned as is
    readonly #syntaxEnabledR = () => reactiveCheckbox(this.#ui.syntaxEnabled())
    readonly #bodyR = () => reactiveExpression(
        [reactiveInput(this.#ui.body()), this.#syntaxEnabledR()],
        (body, syntax) => (syntax ? body : removeCommands(body)) as string
    )

    constructor() {
        super()
        this.#shadow = this.attachShadow({ mode: "closed" })
    }

    connectedCallback() {
        this.#shadow.innerHTML = tmpl("syntax.html", {})
        this.#setExample("examples.txt")

        this.#bodyR().onChange(() => this.#updatePreview())
        this.#ui.examplesLink().addEventListener("click", () => this.#setExample("examples.txt"))
        this.#ui.grammarLink().addEventListener("click", () => this.#setExample("grammar.txt"))
        //this.#ui.syntaxLink().addEventListener("click", () => history.back())

        document.addEventListener("keydown", this.#sectionSignHotkey.bind(this))

        //update preview after section sign has been inserted via hotkey and body lost focus
        this.#ui.body().addEventListener("blur", () => {
            if (this.#insertedSectionSign) {
                this.#insertedSectionSign = false
                this.#updatePreview()
            }
        })

        this.#contentLoaded.resolve()
    }    

    #setExample(name: string) {
        this.#ui.body().value = tmpl(name, {})
        this.#ui.body().scrollTop = 0
        this.#ui.body().selectionStart = 0
        this.#ui.body().selectionEnd = 0
        this.#updatePreview()
    }

    #updatePreview() {        
        const input = replaceAliasesInUriTags(this.#bodyR().get())

        const pr = parse(input)
        if (pr.error !== undefined) {
            const err = pr.error
            let errMsg, startOffset, endOffset, listLanguages
            if (isInputError(err)) {
                const ie = err as InputError
                errMsg = inputErrorMessage(ie)
                startOffset = ie.startOffset
                endOffset = ie.endOffset
                listLanguages = ["ErrCodeBlockIllegalLang", "ErrCodeIllegalLang"].includes(ie.type)
            } else {
                const se = err as PegSyntaxError
                errMsg = se.message
                startOffset = se.location.start.offset
                endOffset = se.location.end.offset
                listLanguages = false
            }

            const tmplData = { errMsg: errMsg, startOffset: startOffset, endOffset: endOffset }
            let previewHtml = tmpl("syntax_error.html", tmplData)
            if (listLanguages) {
                const langs = hljs.listLanguages().concat(["html"]).sort().map((x: string) => ({ lang: x }))
                previewHtml += tmpl("languages.html", { langs: langs })
            }
            this.#ui.preview().innerHTML = previewHtml

            const sel = () => {
                this.#ui.body().setSelectionRange(startOffset, endOffset)
                this.#ui.body().focus({ focusVisible: true } as any)
            }
            sel()
            setTimeout(sel.bind(this), 10) //needed for Firefox
            return
        }

        this.#ui.preview().replaceChildren(new PostBody(input))
    }

    #sectionSignHotkey(ev: KeyboardEvent) {
        if (ev.altKey && ev.shiftKey && ev.key.toLowerCase() === "s") {
            ev.preventDefault()
            const ael = this.#shadow.activeElement
            if (ael?.tagName !== "TEXTAREA") return

            const el = ael as HTMLTextAreaElement
            const start = el.selectionStart
            const end = el.selectionEnd
            const text = el.value
            el.value = text.slice(0, start) + "§" + text.slice(end)
            el.selectionStart = start + 1
            el.selectionEnd = start + 1
            el.dispatchEvent(new Event("input"))

            this.#insertedSectionSign = true
        }
    }
}

init()