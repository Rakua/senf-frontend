export { Tabs, modName }

import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"
import { currentNaviPath, navigateWithinPage, rewriteNaviPath } from "../../../../libs/etc/router.js"
import { ExposedPromise } from "../../../../libs/basic/misc.js"

//#region types
type TmplData = {
    tabs: {
        tabName: string,
        titleId: string,
        contentsId: string
    }[],
    classNames: Record<string, string>
}

type TabData = {
    name: string,
    title: TabTitle,
    contents: TabContents
}
//#endregion

const modName = "TabsComponent"
const lg = new DefaultLogger(modName)
const tmpl = (name: string, data: any) => tmpl0("components/Tabs/" + name, data, preferredTmpl())

const idSep = "."
const classNames = {
    navi: "tab-navi",
    button: "tab-button",
    pages: "tab-pages",
    page: "tab-page",
    active: "active-tab",
    hide: "display-none"
} as const

function init() {
    customElements.define(Tabs.tagName, Tabs)
    customElements.define(Tab.tagName, Tab)
    customElements.define(TabTitle.tagName, TabTitle)
    customElements.define(TabContents.tagName, TabContents)
}

class Tabs extends HTMLElement {
    static readonly tagName = "sfc-tabs"
    static readonly attributes = { parameter: "parameter", hideFromUrl: "hidefromurl" }

    #tabData: TabData[] = []
    #parameter: string
    #defaultTab?: string

    #contentLoaded = new ExposedPromise<void>()
    initialContentLoaded = this.#contentLoaded.promise

    #shadow: ShadowRoot
    #ui = {
        buttons: () => Array.from(this.#shadow.querySelectorAll(className("button"))),
        contents: () => this.#shadow.querySelectorAll(className("page")),
        slot: (tabName: string, part: "title" | "contents") =>
            this.#shadow.getElementById(this.#idOf(tabName, part))!
    }

    constructor() {
        super()
        this.#parameter = "tab"
        this.#shadow = this.attachShadow({ mode: "open" })
    }

    /**
     * Loads the data for the Tabs component from the light DOM and
     * moves the `<sfc-tab-title>` and `<sfc-tab-contents>` nodes to
     * the shadow DOM. The names of the tabs and the parameter 
     * name are immutable, i.e. they cannot be changed after this method
     * has been called.
     */
    connectedCallback() {
        lg.debug("conn callback")
        this.#parameter = this.getAttribute(Tabs.attributes.parameter) ?? this.#parameter

        //initialize shadow DOM
        const allTabs = Array.from(this.querySelectorAll(Tab.tagName)) as Tab[]
        this.#tabData = allTabs.map(tabEl => this.#initTabData(tabEl))
        this.#shadow.innerHTML = tmpl("tabs.html", this.#tmplData())

        //add listeners to navi buttons
        this.#ui.buttons().forEach(btn => btn.addEventListener("click",
            () => this.select(btn.getAttribute(Tab.attributes.name)!)))
        this.#ui.buttons().forEach(btn => btn.addEventListener("auxclick",
            (ev: any) => {
                if (ev.which != 2) return
                //open new tab on middle click
                const url = currentNaviPath().set(this.#parameter, btn.getAttribute(Tab.attributes.name)!).toFragmentId()
                window.open(url, "_blank")
            }))

        //render all tabs
        this.#tabData.forEach(t => this.#render(t.name))

        //determine default tab
        this.#defaultTab = this.#tabData[0].name
        const defaultTabEl = this.querySelector(`${Tab.tagName}[${Tab.attributes.default}]`)
        if (defaultTabEl != null) this.#defaultTab = defaultTabEl.getAttribute(Tab.attributes.name)!

        //select tab
        let selectedTab = this.#defaultTab
        const selectedTabUrl = currentNaviPath().get(this.#parameter)
        if (this.#tabData.some(td => td.name === selectedTabUrl)) {
            //selected tab in URL is valid
            selectedTab = selectedTabUrl as string
        }
        //do not change history because this action is not caused by a user interaction
        this.#select(selectedTab, true)

        this.#contentLoaded.resolve()
    }

    select(tabName: string) {
        //check if tabName exists
        this.#tabDataEntry(tabName)

        if (tabName == this.selected()) {
            //tab to select is already selected

            //if it is the default tab and is not present in the URL parameter => set it there
            const cnp = currentNaviPath()            
            if (tabName === this.#defaultTab && cnp.get(this.#parameter) !== tabName && !this.#hideFromUrl())
                rewriteNaviPath(cnp.set(this.#parameter, tabName))

            return
        }
        this.#select(tabName)
    }

    selected(): string {
        return this.#ui.buttons().find(btn => btn.classList.contains(classNames.active))?.getAttribute(Tab.attributes.name)
            ?? this.#tabData[0].name
    }

    defaultTab() {
        return this.#defaultTab
    }

    /**
     * Replaces the title and/or contents node of a tab with the
     * ones provided in `value`.
     * 
     * @deprecated Use `this.get("tabName").contents.replaceChildren(..)` instead
     */
    set(tabName: string, value: { title?: Node, contents?: Node }) {
        const td = this.#tabDataEntry(tabName)
        Object.assign(td, value)
        this.#render(tabName)
    }

    /**
     * Returns the live title and contents node of a tab in the
     * shadow DOM. When these nodes are modified, the changes
     * are directly rendered in the browser.
     */
    get(tabName: string) {
        const td = this.#tabDataEntry(tabName)
        return { title: td.title, contents: td.contents }
    }

    tabNames() {
        return this.#tabData.map(td => td.name)
    }

    //#region private
    #hideFromUrl() {
        return this.hasAttribute(Tabs.attributes.hideFromUrl)
    }

    #initTabData(tabEl: Tab) {
        const name = tabEl.getAttribute(Tab.attributes.name)
        const title = tabEl.querySelector<TabTitle>(TabTitle.tagName)
        const contents = tabEl.querySelector<TabContents>(TabContents.tagName)
        if (name == null) error(`%O has no ${Tab.attributes.name} attribute`, tabEl)
        if (title == null) error(`%O has no ${TabTitle.tagName} child`, tabEl)
        if (contents == null) error(`%O has no ${TabContents.tagName} child`, tabEl)
        return { name, title, contents }
    }

    #render(tabName: string) {
        const td = this.#tabDataEntry(tabName)

        //this.#ui.slot(tabName, "title").replaceChildren(...td.title.childNodes)
        //this.#ui.slot(tabName, "contents").replaceChildren(...td.contents.childNodes)
        this.#ui.slot(tabName, "title").replaceChildren(td.title)
        this.#ui.slot(tabName, "contents").replaceChildren(td.contents)
    }

    #select(tabName: string, withoutChangingHistory?: boolean) {
        withoutChangingHistory ??= false
        if (!withoutChangingHistory && !this.#hideFromUrl()) {
            const np = currentNaviPath().set(this.#parameter!, tabName)
            navigateWithinPage(np)
        }

        //revert to "no tab is selected" state
        this.#ui.buttons().forEach(el => el.classList.remove(classNames.active))
        this.#ui.contents().forEach(el => el.classList.add(classNames.hide))

        //select tab
        this.#ui.slot(tabName, "title").classList.add(classNames.active)
        this.#ui.slot(tabName, "contents").classList.remove(classNames.hide)

        if(this.#hideFromUrl()) {        
            rewriteNaviPath(currentNaviPath().unset(this.#parameter))
        }
    }

    #tabDataEntry(tabName: string) {
        const x = this.#tabData.find(td => td.name === tabName)
        if (x === undefined) error("tab named %s does not exist in %O", tabName, this)
        return x as TabData
    }

    #tmplData(): TmplData {
        const tdData = {
            classNames,
            tabs: this.#tabData.map(td => ({
                tabName: td.name,
                titleId: this.#idOf(td.name, "title"),
                contentsId: this.#idOf(td.name, "contents")
            }))
        }
        return tdData
    }

    #idOf(tabName: string, type: "title" | "contents") {
        return `tabs${idSep}${this.#parameter}${idSep}${tabName}${idSep}${type}`
    }
    //#endregion
}

class GenericTabsChild extends HTMLElement {
    #ancestor(name: "sfc-tabs" | "sfc-tab") {
        const t = this.closest(name)
        if (t == null) {
            lg.error("%O has no <%s> parent", this, name)
            throw new Error("missing <" + name + "> parent")
        }
        return t
    }

    /**
     * Returns the parent <sfc-tabs> node
     * @returns 
     */
    tabsEl() {
        return this.#ancestor("sfc-tabs") as Tabs
    }

    tabEl() {
        return this.#ancestor("sfc-tab") as Tab
    }

    tabName() {
        const t = this.tabEl()
        const n = t.getAttribute("name")
        if (n == null) {
            lg.error("%O has no name attribute", t)
            throw new Error("missing name attribute in <sfc-tab>")
        }

        return n
    }
}

class Tab extends GenericTabsChild {
    static readonly tagName = "sfc-tab"
    static readonly attributes = { name: "name", default: "default" }
}

class TabTitle extends GenericTabsChild {
    static readonly tagName = "sfc-tab-title"
}

class TabContents extends GenericTabsChild {
    static readonly tagName = "sfc-tab-contents"
}

function className(c: keyof typeof classNames): string {
    return "." + classNames[c]
}

function error(msg: string, ...args: any[]): never {
    lg.impossible(msg, ...args)
    throw new Error(`error in <${Tab.tagName}>, see logger output [IMP][${modName}] for more details`)
}

init()
