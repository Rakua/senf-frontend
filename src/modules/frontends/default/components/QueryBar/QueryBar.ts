export { QueryBar, BaseQuery, BaseQueryEntity, modName, orderPresets }

import { preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"

import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { ExposedPromise, fromJson, MakeOptional, toJson } from "../../../../libs/basic/misc.js"
import { addListener as addRouterListener, removeListener as removeRouterListener, currentNaviPath, navigateWithinPage, NaviPath, navigateTo } from "../../../../libs/etc/router.js"
import { setSelectValue } from "../../../../libs/etc/misc.js"
import { fromSerializableQuery, Query, SerializableQuery } from "../../../../backend/cidb/cidb.js"
import { onChange, ReactiveAtom, reactiveExpression, ReactiveValue } from "../../../../libs/basic/reactive.js"
import { CiGalleryQuery } from "../CiGallery/CiGallery.js"
import { guard, typeOf, unionType } from "../../../../libs/etc/guard.js"
import { canonicalJsonStringify, equivalentJsonValue } from "../../../../libs/etc/sdst.js"
import { watchDialogs } from "../../../../libs/etc/dialogs.js"
import { PeriodSelect } from "../PeriodSelect/PeriodSelect.js"
import { GalleryFilter } from "../GalleryFilter/GalleryFilter.js"
import { newSettings } from "../../../../libs/etc/settings.js"
import { Alert } from "../Alert/Alert.js"
import { PostBody } from "../PostBody/PostBody.js"

//#region types
type BaseQueryEntity = "ci" | "location"
type BaseQuery<T extends BaseQueryEntity> =
    T extends "ci" ? SerializableQuery<"post"> & SerializableQuery<"echo"> :
    T extends "location" ? SerializableQuery<"location"> : never

type OutputQuery<T extends BaseQueryEntity> =
    T extends "ci" ? CiGalleryQuery :
    T extends "location" ? Query<"location"> : never


type Order<T extends "location" | "post" | "echo" | "poster" | "ciMetadata"> = SerializableQuery<T>["order"]
//#endregion

//#region order data
function orderToLabel(entity: BaseQueryEntity, value: any) {
    for (const preset of orderPresets[entity]) {
        if (canonicalJsonStringify(preset.value) === canonicalJsonStringify(value))
            return preset.label
    }
    return "custom"
}

const ciOrderPresets: { label: string, value: Order<"echo"> }[] = [
    { label: "newest first", value: [{ column: "postedOn", order: "desc" }] },
    { label: "oldest first", value: [{ column: "postedOn", order: "asc" }] },
    {
        label: "recently added", value: [
            { column: "addedOn", order: "desc" },
            { column: "postedOn", order: "desc" }
        ]
    },
    { label: "last reply", value: [{ column: "lastReply", order: "desc" }] },
    {
        label: "waiting time",
        value: [
            { column: "waitingTime", order: "desc" },
            { column: "postedOn", order: "asc" }
        ]
    },
    {
        label: "waiting time sum",
        value: [
            { column: "totalWaitingTime", order: "desc" },
            { column: "postedOn", order: "asc" }
        ]
    },
    {
        label: "waiting time max",
        value: [
            { column: "maxWaitingTime", order: "desc" },
            { column: "postedOn", order: "asc" }
        ]
    }
]

const locationOrderPresets: { label: string, value: Order<"location"> }[] = [
    { label: "echo sum", value: [{ column: "echoSum", order: "desc" }, { column: "firstCi", order: "asc" }] },
    { label: "echo max", value: [{ column: "echoMax", order: "desc" }, { column: "firstCi", order: "asc" }] },
    { label: "no. of comments", value: [{ column: "postCount", order: "desc" }, { column: "firstCi", order: "asc" }] },
    { label: "last comment", value: [{ column: "lastPost", order: "desc" }] },
    { label: "last post", value: [{ column: "lastCi", order: "desc" }] },
    { label: "location", value: [{ column: "location", order: "asc" }] },
]

const orderPresets = {
    ci: ciOrderPresets,
    location: locationOrderPresets
}
//#endregion

const modName = "QuerybarComponent"
const lg = new DefaultLogger(modName)
const tmpl = (name: string, data: any) => tmpl0("components/QueryBar/" + name, data, preferredTmpl())

const settings = newSettings(modName, {
    defaultHomeQuery: { default: null as null | {}, guard: guard(unionType(null, {})) },
    defaultPlacesQuery: { default: null as null | {}, guard: guard(unionType(null, {})) }
})

const defaultQueryData = {
    home: {
        parameter: queryParameterName("ci"),
        setting: settings.defaultHomeQuery
    },
    places: {
        parameter: queryParameterName("location"),
        setting: settings.defaultPlacesQuery
    }
}

function init() {
    customElements.define(QueryBar.tagName, QueryBar)
    defaultQueryAspectHotkey()
}

/**
 * The query bar exposes a live query that can be fed into a CiGallery or LocationGallery
 * to automatically update the gallery's contents based on the query.
 * 
 * The live query is is built from the base query supplied by the consumer via the constructor
 * and the query URL parameter. The base query's parts are overwritten by the respective parts
 * in the query URL parameter (if they exist) to build the live query.  
 * 
 * The query URL parameter is bound to the atoms underlying the period, order and filter UI
 * elements and thus automatically updated when one of them changes. 
 * 
 * The atoms underlying the period, order and filter UI are bound to the live query.
 * Thus, whenever the live query changes, the UI elements are updated accordingly. In particular,
 * when the query bar is initialized (constructor) and the first live query is computed, the
 * atoms are updated.
 * 
 * - UI atoms change -> URL parameter is updated
 * - URL parameter changes -> live query is updated
 * - live query changes -> UI atoms values are updated
 * 
 * If the live query is equivalent to the base query then the URL query parameter is removed.
 * 
 */
class QueryBar<T extends BaseQueryEntity> extends HTMLElement {
    static readonly tagName = "sfc-querybar"
    readonly parameter: { query: string }

    readonly scrollToEl?: HTMLElement
    readonly entity: BaseQueryEntity
    readonly page: string
    #baseQuery: BaseQuery<T>
    #liveQuery: ReactiveAtom<BaseQuery<T>>

    #orderAtom: ReactiveAtom<BaseQuery<T>["order"]>

    #routerListenerId: string

    #contentLoaded = new ExposedPromise<void>()
    initialContentLoaded = this.#contentLoaded.promise

    #shadow: ShadowRoot
    readonly #ui = {
        querybar: () => this.#shadow.getElementById("querybar") as HTMLElement,
        galleryFilterC: () => this.#shadow.getElementById("galleryFilterC") as HTMLElement,

        periodSelect: () => this.#shadow.getElementById("periodSelect") as PeriodSelect,
        orderSelect: () => this.#shadow.getElementById("orderSelect") as HTMLSelectElement,
        galleryFilter: () => this.#shadow.getElementById("galleryFilter") as GalleryFilter<T>,
    }

    constructor(entity: T, baseQuery: BaseQuery<T>) {
        super()

        this.page = currentNaviPath().getPage() ?? "home"
        lg.debug("page: ", this.page)
        this.entity = entity
        this.parameter = { query: queryParameterName(this.entity) }

        this.#baseQuery = baseQuery
        this.#liveQuery = new ReactiveAtom(this.#buildQuery(), equivalentJsonValue)
        this.#orderAtom = new ReactiveAtom(this.#liveQuery.get().order, equivalentJsonValue)

        this.#shadow = this.attachShadow({ mode: "open" })
        this.#shadow.innerHTML = tmpl("querybar.html", { entity: this.entity, orderPresets: orderPresets[this.entity] })
        watchDialogs(this.#shadow)

        //bind order atom to order select and vice versa
        this.#ui.orderSelect().addEventListener("change", () => {
            const val = this.#ui.orderSelect().value
            if (val == "custom") return
            this.#orderAtom.set(fromJson(val) as any)
        })
        onChange(this.#orderAtom, nv => setSelectValue(this.#ui.orderSelect(), toJson(nv), orderToLabel(this.entity, nv)))

        //add filter dialog
        const galleryFilterEl = new GalleryFilter(this.entity)
        galleryFilterEl.id = "galleryFilter"
        this.#ui.galleryFilterC().replaceChildren(galleryFilterEl)

        //update period/order/filter atoms from live query
        onChange(this.#liveQuery, q => {
            lg.debug("update UI from live query: %O", q)

            //only set filters in UI that are part of URL parameter
            const urlFilter0 = (currentNaviPath().get(this.parameter.query) as any)?.filter
            const urlFilter = typeOf(urlFilter0) == "object" ? urlFilter0 : {}

            this.#ui.galleryFilter().set(urlFilter)
            this.#ui.periodSelect().set(q.period ?? null)
            this.#orderAtom.set(q.order)
        })

        //update URL query parameter from period/order/filter atoms
        const rexpr = reactiveExpression([this.#ui.periodSelect(), this.#orderAtom, this.#ui.galleryFilter()], (period, order, filter) => ({ period, order, filter }))
        rexpr.onChange(queryParam => {
            if((currentNaviPath().getPage() ?? "home") != this.page) {
                lg.debug("different page, don't change url anymore, %O != %O", this.page, currentNaviPath().getPage() ?? "home")
                return
            }

            lg.debug("update URL query from UI: %O", queryParam)

            //todo: check equivalent query results
            const newQuery = this.#buildQuery(queryParam)
            const curQuery = this.#liveQuery.get()
            if (equivalentQuery(newQuery, curQuery)) return
            lg.debug("queries not equivalent")

            const cnp = currentNaviPath()
            cnp.set(this.parameter.query, queryParam)
            navigateWithinPage(cnp)
        })

        //update live query from URL query parameter
        this.#routerListenerId = addRouterListener((ev) => {
            if((currentNaviPath().getPage() ?? "home") != this.page) {
                lg.debug("different page, don't change url anymore, %O != %O", this.page, currentNaviPath().getPage() ?? "home")
                return
            }
            
            if (toJson(ev.data.oldPath.get(this.parameter.query)) == toJson(ev.data.newPath.get(this.parameter.query))) return
            const q = this.#buildQuery()
            lg.debug("update live query from URL query: %O", q)
            this.#liveQuery.set(q)
        })

        this.#contentLoaded.resolve()
    }

    /**
     * Computes query from base query and query URL parameter. The base
     * query is used as initial value and the period, order and filters 
     * set in the URL overwrite their respective parts in the base query.
     */
    #buildQuery(queryParamInput?: any) {
        const cnp = currentNaviPath()

        if (queryParamInput == undefined) {
            lg.debug("#build: undefined queryParamInput")
        } else {
            lg.debug("#build: defined queryParamInput: %O", queryParamInput)
        }

        const queryParam0 = queryParamInput ?? cnp.get(this.parameter.query)
        try {
            if (queryParam0 === undefined) return this.#baseQuery
            if (typeOf(queryParam0) !== "object") throw new Error("expected object, got " + typeOf(queryParam0))

            const newQuery = structuredClone(this.#baseQuery) as BaseQuery<T>
            newQuery.filter ??= {}

            //todo: test if period, order, filter have correct shape
            const queryParam = queryParam0 as MakeOptional<BaseQuery<T>, "index">
            if (queryParam.period !== undefined) newQuery.period = queryParam.period
            if (queryParam.order !== undefined) newQuery.order = queryParam.order
            if (queryParam.filter !== undefined) Object.assign(newQuery.filter, queryParam.filter)

            // lg.debug("BUILD bse: ", canonicalJsonStringify(this.#baseQuery))
            // lg.debug("BUILD prm: ", canonicalJsonStringify(queryParam))
            // lg.debug("BUILD old: ", canonicalJsonStringify(this.#liveQuery.get()))
            // lg.debug("BUILD new: ", canonicalJsonStringify(newQuery))

            return newQuery
        } catch (e) {
            lg.warn("Invalid query parameter (ignoring it): %O", e)
            return this.#baseQuery
        }
    }

    disconnectedCallback() {
        removeRouterListener(this.#routerListenerId)
    }

    async liveQueryCi(): Promise<ReactiveValue<Promise<OutputQuery<"ci">>>> {
        await this.initialContentLoaded
        if (this.entity !== "ci") throw new Error("liveQueryCi is only available for entity 'ci'")
        return reactiveExpression([this.#liveQuery], (q) => fromSerializableQuery("echo", q as BaseQuery<"ci">) as Promise<CiGalleryQuery>)
    }

    async liveQueryLocation(): Promise<ReactiveValue<Promise<OutputQuery<"location">>>> {
        await this.initialContentLoaded
        if (this.entity !== "location") throw new Error("liveQueryLocation is only available for entity 'location'")
        return reactiveExpression([this.#liveQuery], async (q) => await fromSerializableQuery("location", q as BaseQuery<"location">))
    }

    /**
     * If a default query setting exists, it will be automatically set if no other URL parameter
     * besides the page parameter (or none at all) is set.
     * 
     * @param page 
     * @param defaultQuerySetting setting of the page associated with the default query
     */
    async loadDefaultQuery(page: "home" | "places") {
        await this.initialContentLoaded
        const dqd = defaultQueryData[page]
        const defaultQuery = dqd.setting.get()
        if (defaultQuery != null && currentNaviPath().parameters(true).length == 0) {
            lg.debug("setting default query")
            const np = new NaviPath(page).set(dqd.parameter, defaultQuery)
            navigateTo(np, true)
            lg.debug("navigateTo finished")
        }
    }
}

function queryParameterName(entity: BaseQueryEntity) {
    switch (entity) {
        case "ci": return "qc"
        case "location": return "ql"
    }
}

function equivalentQuery<T extends BaseQueryEntity>(q1: BaseQuery<T>, q2: BaseQuery<T>): boolean {
    if (q1.filter == undefined) q1.filter = {}
    if (q2.filter == undefined) q2.filter = {}
    lg.debug("\nnew %O\ncur %O", fromJson(canonicalJsonStringify(q1)), fromJson(canonicalJsonStringify(q2)))
    return canonicalJsonStringify(q1) == canonicalJsonStringify(q2)
}

function defaultQueryAspectHotkey() {
    lg.debug("defaultQueryAspectHotkey listener registered")
    document.addEventListener("keyup", (ev) => {
        const page = currentNaviPath().getPage() ?? "home"
        if (page != "home" && page != "places") return
        const dqd = defaultQueryData[page]

        if (ev.altKey && ev.key == "D" && ev.ctrlKey) {
            const curQuery = currentNaviPath().get(dqd.parameter)
            if (curQuery == undefined) return
            const res = dqd.setting.setSafely(curQuery)
            if (res.valid && res.set) {
                const el = new Alert("Default query for " + page + " page has been set: <div class='queryBody'></div>")
                const divEl = el.shadowRoot!.querySelector<HTMLElement>("div.queryBody")
                if (divEl != null) {
                    const queryJson = `§<json\n${JSON.stringify(curQuery, null, 2)}\n§>`
                    divEl.replaceChildren(new PostBody(queryJson))
                }
                document.body.appendChild(el)
                el.alert().then(() => document.body.removeChild(el))
            }
        } else if (ev.altKey && ev.key == "d" && ev.ctrlKey) {
            if (dqd.setting.unset()) {
                const el = new Alert("Default query for " + page + " page has been unset.")
                document.body.appendChild(el)
                el.alert().then(() => document.body.removeChild(el))
            }
        }
    })
}

init()
