//#region import/export
export { PostPage, modName }

import { tmpl as tmpl0 } from "../../tmpl.js"
import { preferredTmpl, mainSettings } from "../../../../../config.js"
import { DefaultLogger, } from "../../../../libs/basic/logger.js"
import { currentNaviPath, navigateTo, NaviPath } from "../../../../libs/etc/router.js"
import { App, pageTitleR } from "../../App/App.js"
import { approxDuration, setSelectValue } from "../../../../libs/etc/misc.js"
import * as Post from "../../../../backend/post/post.js"
import { PostContent } from "../../../../backend/post/types.js"
import { QueuePage } from "../Queue/Queue.js"
import { reactiveExpression, reactiveCheckbox, reactiveInput } from "../../../../libs/basic/reactive.js"
import { PostBody } from "../../../default/components/PostBody/PostBody.js"
import { IsolatedStorage } from "../../../../libs/etc/storage.js"
import { addNewlineBeforeNestableClosingTags, InputError, inputErrorMessage, isInputError, parse, PegSyntaxError, removeCommands, replaceAliasesInUriTags, replaceKeyIdsWithAliasesInUriTags } from "../../../../backend/parser/parser.js"
import hljs from "../../../../libs/highlight/highlight.js"
import { ExposedPromise, isInteger, isNumber, toNumber } from "../../../../libs/basic/misc.js"
import { toCiUrn } from "../../../../backend/cidb/types/ci.js"
import { fallback, guard } from "../../../../libs/etc/guard.js"
import { fromKeys, isUserCiPrimaryKey, UserCiPrimaryKey } from "../../../../backend/cidb/cidb.js"
import { watchDialogs } from "../../../../libs/etc/dialogs.js"
import { Alert } from "../../components/Alert/Alert.js"
import { Prompt } from "../../components/Prompt/Prompt.js"
//#endregion

//#region types
type Mode = ModeNew | ModeRepost | ModeQuote
type ModeNew = {
    type: "new",
    uri?: string,
    back: boolean, //true => history.back() after post instead of going to queue page
    restore: () => Promise<boolean> //true => restore draft
}
type ModeQuote = {
    type: "quote",
    ciPk: UserCiPrimaryKey,
    back: false,
    restore: () => Promise<boolean>
}
type ModeRepost = {
    type: "repost",
    postId: string
    back: false,
    restore: () => Promise<boolean>
}

type Draft = {
    location: string,
    body: string,
    wt: number | null,
    syntax: boolean,
}
//#endregion

const modName = "PostPage"
const tmpl = (name: string, data: any) => tmpl0("pages/Post/" + name, data, preferredTmpl())
const lg = new DefaultLogger(modName)
const storage = new IsolatedStorage<"draft">("session", modName)

const minWaitingTimeMin = 1
const defaultLocation = "tag:misc"

const maxBodyLength = 9000
const pathParam = {
    type: "mode",
    back: "back",
    uri: "uri",
    ciPk: "ci",
    postId: "pid"
}

function init() {
    customElements.define(PostPage.tagName, PostPage)
}

class PostPage extends HTMLElement {
    static readonly pageName = "post"
    static readonly tagName = "sf-post"
    static readonly paths = {
        new: (uriOrPk?: string | UserCiPrimaryKey, back?: boolean) => {
            back ??= false
            const np = new NaviPath(this.pageName)
            if (back) np.set(pathParam.back, 1)
            if (uriOrPk) {
                const uri = typeof uriOrPk == "string" ? uriOrPk : toCiUrn(uriOrPk)
                np.set(pathParam.uri, uri)
            }
            return np
        },
        reply: (uriOrPk: string | UserCiPrimaryKey) => PostPage.paths.new(uriOrPk, true),
        quote: (ci: UserCiPrimaryKey) => new NaviPath(this.pageName).set(pathParam.type, "quote").set(pathParam.ciPk, ci),
        repost: (post: string) => new NaviPath(this.pageName).set(pathParam.type, "repost").set(pathParam.postId, post)
    }

    mode(): Mode {
        const inAppNavi = async () => ["navigateTo", "navigateWithinPage"].includes(await App.lastNavigation())
        /**
         * restore draft in new mode on browser back/forward or refresh
         */
        const restore = async () => !(await inAppNavi())
        const defaultMode: Mode = { type: "new", back: false, restore: restore }
        const cnp = currentNaviPath()
        const mode = fallback(cnp.get(pathParam.type), "new", guard("")) as Mode["type"]

        switch (mode) {
            case "new":
                const uri = cnp.get(pathParam.uri)
                const back = cnp.has(pathParam.back)
                return typeof uri == "string"
                    ? { type: "new", uri: uri, back: back, restore: async () => true }
                    : defaultMode

            case "quote":
                const ci = cnp.get(pathParam.ciPk)
                if (!isUserCiPrimaryKey(ci)) return defaultMode
                return { type: "quote", ciPk: ci, back: false, restore: restore }

            case "repost":
                const post = cnp.get(pathParam.postId)
                if (typeof post != "string") return defaultMode
                return { type: "repost", postId: post, back: false, restore: restore }

        }
    }

    #contentLoaded = new ExposedPromise<void>()
    readonly initialContentLoaded = this.#contentLoaded.promise

    #shadow: ShadowRoot
    readonly #ui = {
        waitingTime: () => this.#shadow.getElementById("waitingTime") as HTMLSelectElement,
        location: () => this.#shadow.getElementById("location") as HTMLInputElement,
        body: () => this.#shadow.getElementById("body") as HTMLTextAreaElement,
        postSigned: () => this.#shadow.getElementById("postSigned") as HTMLButtonElement,
        postUnsigned: () => this.#shadow.getElementById("postUnsigned") as HTMLButtonElement,
        preview: () => this.#shadow.getElementById("preview") as HTMLDivElement,
        syntaxEnabled: () => this.#shadow.getElementById("syntaxEnabled") as HTMLInputElement
    }

    #cwtPrompt = new Prompt("Input custom waiting time in minutes", { validator: (x) => isInteger(x) && toNumber(x)! > 0 })

    readonly #syntaxEnabledR = () => reactiveCheckbox(this.#ui.syntaxEnabled())
    /**
     * Body as reactive value that is updated on every input but 
     * throttled. If syntax is disabled, the '§'-sign is escaped.
     */
    readonly #bodyR = () => reactiveExpression(
        [reactiveInput(this.#ui.body(), "change"), this.#syntaxEnabledR()],
        (body, syntax) => this.#conditionBody(body, syntax)
    )

    #conditionBody(body: string, syntax: boolean) {
        body = body.trim()
        if (!syntax) body = removeCommands(body)
        return replaceAliasesInUriTags(body)
    }

    constructor() {
        super()

        const mode = this.mode()
        const title = mode.type == "repost" ? "Repost comment" : "New comment"
        pageTitleR.set(title)
        this.#shadow = this.attachShadow({ mode: "open" })
        this.#shadow.innerHTML = tmpl("post.html", this.#tmplData(title))
        watchDialogs(this.#shadow)
        this.#shadow.append(this.#cwtPrompt)

        if (mode.type == "new" && mode.uri != undefined) {
            this.#ui.location().value = mode.uri
        }

        //register listeners
        const postF = (sign: boolean) => () => (this.post.bind(this))(sign)
        this.#ui.postSigned().addEventListener("click", () => this.#validateForm(postF(true)))
        this.#ui.postUnsigned().addEventListener("click", () => this.#validateForm(postF(false)))

        this.#ui.waitingTime().addEventListener("change", this.#customWaitingTime.bind(this))
        this.#registerSectionSignHotkey()

        this.#ui.location().addEventListener("input", (ev0: Event) => {
            const ev = ev0 as InputEvent
            //lg.debug("location input ev", ev)
            if (ev.inputType == "insertReplacementText") {
                this.#restoreDraft(null)
            }
        })

        //remember draft on form change
        const inpEls = [
            { el: this.#ui.location(), type: "input" },
            { el: this.#ui.body(), type: "input", },
            { el: this.#ui.waitingTime(), type: "change", },
            { el: this.#ui.syntaxEnabled(), type: "change", }
        ]
        for (const x of inpEls) {
            x.el.addEventListener(x.type, () => this.#rememberDraft())
            x.el.addEventListener(x.type, () => this.#rememberDraft())
        }

        this.#bodyR().onChange(() => {
            this.addNewlineBeforeClosingTag()
            this.#updatePreview()
        })

        this.#initFormContents().then(() => this.#contentLoaded.resolve())

        lg.debug("PostPage mode: %O", this.mode())
    }

    async post(sign: boolean) {
        const mode = this.mode()

        try {
            this.#shadow
                .querySelectorAll("input, select, button, textarea")
                .forEach(x => (x as HTMLInputElement).disabled = true)

            const ev = await Post.enqueue(this.#getPostContent(), sign)
            lg.debug("#post ev: %O", ev.data.post)
            this.#forgetDraft()

            //if repost, remove from aborted
            if (mode.type == "repost") {
                try {
                    await Post.remove(mode.postId)
                } catch (e) {
                    lg.error("Failed to remove repost from aborted: %O", e)
                }
            }

            if (mode.back) {
                history.back()
            } else {
                navigateTo(QueuePage.paths.enqueued)
            }
            if (!sign) return //unsigned post => nothing else to do

            await App.signPost(ev.data.post)
        } catch (e) {
            lg.error("Failed to post: %O", e)
        }
    }

    /**
     * Executes `f` if form values are valid. Otherwise, the user is
     * notified about invalid fields.
     */
    #validateForm(f: () => void) {
        try {
            const postContent = this.#getPostContent()
            if (postContent.location === "")
                throw new Error("Location cannot be empty")

            //todo: complete validation
            const uri = postContent.location
            const scheme = uri.split(":")[0]
            const legalSchemes = mainSettings.acceptedSchemes.get()
            if (!legalSchemes.includes(scheme))
                throw new Error("Illegal URI scheme (accepted: " + legalSchemes.join(", ") + ")")
            if (!isNumber(this.#ui.waitingTime().value))
                throw new Error("Select waiting time")

            const body = this.#bodyR().get()
            if (body.length > maxBodyLength) throw new Error(`Content is ${body.length - maxBodyLength} character(s) too long`)

            const pr = parse(body)
            if (pr.error !== undefined) throw new Error("Content contains a syntax error. Disable syntax if you don't want to use any commands.")

            f()
        } catch (e) {
            lg.error("Failed validating post", e)
            const alertEl = new Alert((e as Error).message)
            this.#shadow.append(alertEl)
            alertEl.alert()
        }
    }


    #updatePreview() {
        //todo: if content too long show error somewhere
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

    //#region initialize form contents

    /**
     * Initializes the form contents based on the page mode.
     * 
     * @returns false iff restoring or quoting was not possible (e.g. 
     * because the post does not exist) 
     */
    async #initFormContents() {
        const mode = this.mode()
        const restore = await mode.restore()

        //fill out post form for certain modes
        switch (mode.type) {
            case "new":

                lg.debug("restore:", restore, await App.lastNavigation())
                if (mode.uri == undefined && restore) {
                    lg.debug("try to restore because back/forward navigation")
                    //restore draft in new mode on back/forward navigation or refresh
                    return this.#restoreDraft(null)
                } else if (mode.uri != undefined) {
                    lg.debug("try to restore because uri matches draft loc")
                    //restore if the draft's location matches the new post's URI
                    return this.#restoreDraft(mode.uri)
                } else {
                    lg.debug("nothing to restore")
                    //nothing to restore
                    return true
                }

            case "repost":
                if (restore) return this.#restoreDraft(null)
                return this.#restoreFromAborted(mode.postId)

            case "quote":
                if (restore) return this.#restoreDraft(null)
                return await this.#quotePost(mode.ciPk)
        }
    }

    #restoreFromAborted(postId: string) {
        const gpbi = Post.getPostById(postId)
        if (gpbi != undefined && gpbi.location == Post.ItemLocation.Aborted) {
            const post = gpbi.post
            const location = post.postContent.location
            const body = post.postContent.content
            const wt = post.postContent.waitingTimeSec / 60
            this.#fillForm(location, body, wt, true)
            return true
        }
        return false
    }

    async #quotePost(ciPk: UserCiPrimaryKey) {
        const p = (await fromKeys("post", [ciPk]))[0]
        if (p === undefined) return false
        const location = p.ciUrn()
        const body = `§bq\n${p.content()}\n§eq`
        this.#fillForm(location, body, null, true)
        return true
    }
    //#endregion

    //#region draft
    #rememberDraft() {
        lg.debug("remember draft")
        const draft: Draft = {
            location: this.#ui.location().value.trim(),
            body: this.#ui.body().value.trim(),
            wt: toNumber(this.#ui.waitingTime().value),
            syntax: this.#ui.syntaxEnabled().checked
        }
        if (draft.location == "" || draft.body == "") {
            lg.debug("don't remember draft with empty location or body")
            return
        }
        storage.set("draft", draft)
    }

    #forgetDraft() {
        lg.debug("forget draft")
        storage.delete("draft")
    }

    /**
     * If `uri` is non-null, the draft is only restored if its location matches
     * the given URI.
     * @returns true if draft exists and has been restored
     */
    #restoreDraft(uri: null | string) {
        lg.debug("restore draft")
        const draft = storage.get("draft") as Draft | undefined
        if (draft == undefined) {
            lg.debug("draft undefined")
            return false
        }
        if (uri != null && draft.location != uri) {
            lg.debug("draft location does not match uri", draft.location, uri)
            return false
        }
        this.#fillForm(draft.location, draft.body, draft.wt, draft.syntax)
        return true
    }
    //#endregion

    //#region waiting time

    /**
     * What happens when "Custom..." waiting time is selected
     */
    async #customWaitingTime() {
        const wtel = this.#ui.waitingTime()
        if (wtel.value != "custom") return
        const cwt = await this.#cwtPrompt.prompt()
        if (cwt == null) {
            wtel.selectedIndex = 0
            return
        }
        this.#setWaitingTime(toNumber(cwt) ?? 0)
        this.#ui.waitingTime().dispatchEvent(new Event("change"))
    }

    #setWaitingTime(waitingTimeMin: number) {
        waitingTimeMin = Math.max(toNumber(Math.abs(waitingTimeMin).toFixed(0))!, 1)
        const wtEl = this.#ui.waitingTime()
        const secondLast = wtEl.options.length - 1
        setSelectValue(wtEl, waitingTimeMin.toString(), approxDuration(waitingTimeMin), secondLast)
    }
    //#endregion

    //#region misc

    /**
     * Fills out the form with the given data. It also replaces keyIds with aliases and
     * adds newlines before nestable closing tags. Then it updates the preview.
     */
    #fillForm(location: string, body: string, waitingTimeMin: number | null, syntaxEnabled: boolean) {
        this.#ui.location().value = location
        this.#ui.body().value = addNewlineBeforeNestableClosingTags(replaceKeyIdsWithAliasesInUriTags(body))
        this.#ui.syntaxEnabled().checked = syntaxEnabled

        this.#setWaitingTime(waitingTimeMin ?? minWaitingTimeMin)
        this.#updatePreview()
    }

    #getPostContent(): PostContent {
        let loc = this.#ui.location().value.trim()
        if (loc == "") loc = defaultLocation

        const content = replaceAliasesInUriTags(this.#bodyR().get())
        const wt = toNumber(this.#ui.waitingTime().value) ?? 1

        return {
            location: URL.parse(loc)?.href ?? loc,
            waitingTimeSec: 60 * wt,
            content: content
        }
    }

    #registerSectionSignHotkey() {
        document.addEventListener("keydown", (ev: KeyboardEvent) => {
            if (ev.altKey && ev.shiftKey && ev.key.toLowerCase() === "s") {
                ev.preventDefault()
                if (this.#shadow.activeElement!.id !== this.#ui.body().id) return

                const body = this.#ui.body()
                const start = body.selectionStart
                const end = body.selectionEnd
                const text = body.value
                body.value = text.slice(0, start) + "§" + text.slice(end)
                body.selectionStart = start + 1
                body.selectionEnd = start + 1
                body.dispatchEvent(new Event("input"))
                body.focus()
            }
        })
    }

    addNewlineBeforeClosingTag() {
        const body = this.#ui.body()
        body.value = addNewlineBeforeNestableClosingTags(body.value)
        body.dispatchEvent(new Event("input"))
    }

    #tmplData(title: string) {
        const selectWaitingTimes = mainSettings.selectWaitingTimes.get().map((v, i) => ({
            selected: i == 0,
            value: v,
            label: approxDuration(v)
        }))

        const td = {
            title: title,
            selectWaitingTimes: selectWaitingTimes,
            draftLocation: (storage.get("draft") as Draft | undefined)?.location
        }

        return td
    }
    //#endregion

}

init()