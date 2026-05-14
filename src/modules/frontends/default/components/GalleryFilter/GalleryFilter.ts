export { GalleryFilter, modName }

import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"
import { ExposedPromise, fromJson, splitAt, toNumber } from "../../../../libs/basic/misc.js"
import { watchDialogs } from "../../../../libs/etc/dialogs.js"
import { onChange, ReactiveAtom, ReactiveSyncWritableValue, } from "../../../../libs/basic/reactive.js"
import { BaseQuery, BaseQueryEntity } from "../QueryBar/QueryBar.js"
import { ValuesRegex } from "../../../../backend/cidb/types/query.js"
import { hideEl, setSelectValue, showChildEl, showEl, tristateCheckbox } from "../../../../libs/etc/misc.js"
import { canonicalJsonStringify, equivalentJsonValue } from "../../../../libs/etc/sdst.js"
import { getCategories } from "../../../../backend/cidb/cidb.js"
import { CategoryMapping, CategorySelection } from "../../../../backend/cidb/db/category.js"

type Filter<T extends BaseQueryEntity> = NonNullable<BaseQuery<T>["filter"]>
type ObservedAttributes = typeof GalleryFilter.observedAttributes[number]
type TmplData = {
    entity: BaseQueryEntity,
    filterButtonLabel?: string
}

type FilterField<T extends BaseQueryEntity> = (typeof filterFields)[T][number]
const filterFields = {
    ci: ["scheme", "posterKind", "waitingTime", "totalWaitingTime", "maxWaitingTime", "hasAlias", "location", "catIds", "media"],
    location: ["scheme", "location", "catIds", "media", "echoSum", "echoMax"]
} as const satisfies Record<BaseQueryEntity, string[]>

const modName = "GalleryFilter"
const tmpl = (name: string, data: any) => tmpl0("components/GalleryFilter/" + name, data, preferredTmpl())
const lg = new DefaultLogger(modName)


function init() {
    customElements.define(GalleryFilter.tagName, GalleryFilter)
}

class GalleryFilter<T extends BaseQueryEntity> extends HTMLElement implements ReactiveSyncWritableValue<Filter<T>> {
    static readonly tagName = "sfc-gallery-filter"
    static observedAttributes = ["label", "entity"] as const

    readonly entity: T

    #atom = new ReactiveAtom<Filter<T>>({}, equivalentJsonValue)

    #sourceListLoaded = new ExposedPromise<null>()

    #shadow: ShadowRoot
    readonly #ui = {
        filterButton: () => this.#shadow.getElementById("filterButton") as HTMLButtonElement,
        filterDialog: () => this.#shadow.getElementById("filterDialog") as HTMLDialogElement,

        filterFieldset: (x: FilterField<T>) => this.#shadow.querySelector<HTMLFieldSetElement>(".filter-list fieldset[name='" + x + "']")!,
        filterFieldsetLegendInput: (x: FilterField<T>) => this.#shadow.querySelector<HTMLInputElement>(".filter-list fieldset[name='" + x + "'] legend input")!,
        filterFieldsetFormInputs: <X extends "input" | "select" | "textarea">(x: FilterField<T>, y: X) => Array.from(this.#shadow.querySelectorAll<X extends "input" ? HTMLInputElement : (X extends "textarea" ? HTMLTextAreaElement : HTMLSelectElement)>(".filter-list fieldset[name='" + x + "'] .formPart " + y)),
        filterFieldsets: () => this.#shadow.querySelectorAll<HTMLFieldSetElement>("fieldset"),

        sourceContainer: () => this.#shadow.getElementById("sourceContainer") as HTMLElement,

        sourceAll: () => this.#ui.sourceContainer().querySelector<HTMLInputElement>("input[name='all']")!,
        sourceUser: () => this.#ui.sourceContainer().querySelector<HTMLInputElement>("input[name='user']")!,
        sourceArchives: () => this.#ui.sourceContainer().querySelectorAll<HTMLInputElement>("input[name='archive']")!,
        sourceCategories: () => this.#ui.sourceContainer().querySelectorAll<HTMLInputElement>("input[name='category']")!,

        sourceMultiCat: () => this.#ui.sourceContainer().querySelectorAll<HTMLElement>("li.multiCat"),

        filterMode: () => this.#shadow.getElementById("filterMode") as HTMLElement,
        advancedA: () => this.#shadow.getElementById("advancedA") as HTMLAnchorElement,
        simpleA: () => this.#shadow.getElementById("simpleA") as HTMLAnchorElement,
        advancedFilters: () => this.#shadow.querySelectorAll<HTMLElement>("div.advancedFilter"),

        /* generic dialog buttons */
        dialogOkButton: (x: HTMLDialogElement) => x.querySelector(".okButton")! as HTMLButtonElement,
        dialogCloseButton: (x: HTMLDialogElement) => x.querySelector(".closeButton")! as HTMLButtonElement
    }

    constructor(entity?: T) {
        super()
        this.#shadow = this.attachShadow({ mode: "open" })

        const e = entity ?? this.getAttribute("entity") ?? ""
        if (!["ci", "location"].includes(e)) {
            lg.error("Entity of %O must be 'ci' or 'location' but got %O", this, e)
            throw new Error("Invalid 'entity' attribute in <sfc-gallery-filter>")
        }
        this.entity = e as T

        const tmplData: TmplData = {
            entity: this.entity,
            filterButtonLabel: this.getAttribute("label") ?? undefined
        }
        this.#shadow.innerHTML = tmpl("gallery_filter.html", tmplData)
        watchDialogs(this.#shadow)

        this.#ui.filterButton().addEventListener("click", () => this.#ui.filterDialog().showModal())
        this.#ui.dialogOkButton(this.#ui.filterDialog()).addEventListener("click", () => this.#ui.filterDialog().close("ok"))
        this.#ui.dialogCloseButton(this.#ui.filterDialog()).addEventListener("click", () => this.#ui.filterDialog().close())
        this.#ui.filterDialog().addEventListener("close", () => {
            if (this.#ui.filterDialog().returnValue == "ok") {
                //take new values
                this.#updateAtom()
            } else {
                //reset form to current atom's value
                this.#updateForm()
            }

            this.#ui.filterDialog().returnValue = "" //reset ok flag
        })

        //bind sources 
        const categoriesR = getCategories()
        onChange(categoriesR, async (catsP) => {
            const cats = await catsP
            this.#updateSourceList(cats)
        })

        //disable filter fieldsets by default and bind to checkbox in legend
        for (const filterName of filterFields[this.entity]) {
            const fs = this.#ui.filterFieldset(filterName)
            const li = this.#ui.filterFieldsetLegendInput(filterName)
            fs.disabled = true
            li.addEventListener("change", () => { fs.disabled = !li.checked })
            fs.addEventListener("dblclick", () => {
                //don't disable fieldset via dblclick
                if (li.checked) return

                li.checked = !li.checked
                li.dispatchEvent(new Event("change"))
            })
        }

        //advances/simple filters
        this.#ui.advancedA().addEventListener("click", () => {
            //show advanced filter
            this.#ui.advancedFilters().forEach(el => showEl(el))
            showChildEl(this.#ui.filterMode(), this.#ui.simpleA())
        })
        this.#ui.simpleA().addEventListener("click", () => {
            //hide advanced filters
            this.#ui.advancedFilters().forEach(el => hideEl(el))
            showChildEl(this.#ui.filterMode(), this.#ui.advancedA())
        })
        //start simple
        this.#ui.simpleA().click()
    }

    /**
     * Update the atom with the data in the filter dialog
     */
    #updateAtom() {
        lg.debug("#updateAtom old %O", fromJson(canonicalJsonStringify(this.get())))

        const curFilter = structuredClone(this.get())

        for (const filterName of filterFields[this.entity]) {
            const isActive = this.#ui.filterFieldsetLegendInput(filterName).checked
            // lg.debug("filter name %O isActive %O", filterName, isActive)
            if (!isActive) {
                //filter fieldset deactivated => remove from filters
                delete (curFilter as any)[filterName]
                continue
            }

            //set filter value from inputs
            const inps = this.#ui.filterFieldsetFormInputs(filterName, "input")
            const sels = this.#ui.filterFieldsetFormInputs(filterName, "select")
            const tas = this.#ui.filterFieldsetFormInputs(filterName, "textarea")
            switch (filterName) {
                case "location": {
                    const inp = tas[0]
                    const sel = sels[0]
                    curFilter[filterName] = {
                        defined: true,
                        condition: {
                            values: {
                                type: "regex",
                                patterns: inp.value.split("\n")
                            },
                            invert: sel.value == "=0"
                        }
                    }
                    lg.debug("cutFilter[%O] = %O", filterName, curFilter[filterName])
                    break
                }

                case "scheme": {
                    const schemes: any[] = []
                    inps.forEach(inp => {
                        const values = inp.value == "http" ? ["http", "https"] : [inp.value]
                        if (inp.checked) schemes.push(...values)
                    })

                    curFilter[filterName] = {
                        condition: { values: schemes }
                    }
                    break
                }

                case "posterKind": {
                    const posterKinds: any[] = []
                    inps.forEach(inp => { if (inp.checked) posterKinds.push(inp.value) })

                    curFilter[filterName] = {
                        condition: { values: posterKinds }
                    }
                    break
                }

                case "hasAlias": {
                    (curFilter as any)[filterName] = {
                        condition: sels[0].value == "true"
                    }
                    lg.debug("hasAlias: %Q", curFilter)
                    break
                }

                case "waitingTime":
                case "totalWaitingTime":
                case "maxWaitingTime":
                case "echoSum":
                case "echoMax": {
                    const minInp = inps[0]
                    const maxInp = inps[1]

                    const start = toNumber(minInp.value.trim()) ?? undefined
                    const end = toNumber(maxInp.value.trim()) ?? undefined
                    if (start === undefined && end === undefined) break
                    (curFilter as any)[filterName] = {
                        condition: {
                            values: { type: "interval", start: start, end: end }
                        }
                    }
                    lg.debug("set filter %O, %O", filterName, curFilter)
                    break
                }

                case "catIds": {
                    const catSel: CategorySelection = []
                    if (this.#ui.sourceUser().checked) catSel.push({ type: "rest" })
                    this.#ui.sourceContainer().querySelectorAll<HTMLInputElement>("li.singleCat input[name='archive']").forEach(el => {
                        if (el.checked) catSel.push({ "type": "archive", archive: el.value })
                    })
                    this.#ui.sourceContainer().querySelectorAll("li.multiCat").forEach(el => {
                        const archiveUrl = el.querySelector<HTMLInputElement>("input[name='archive']")!.value
                        const selectedCatNames: (string | null)[] = []
                        el.querySelectorAll<HTMLInputElement>("input[name='category']").forEach(el => {
                            if (!el.checked) return
                            const res = splitAt(el.value, " ")
                            if (!res.found) return
                            selectedCatNames.push(res.right == "" ? null : res.right)
                        })
                        catSel.push({ type: "archive", archive: archiveUrl, categories: selectedCatNames })
                    })

                    curFilter[filterName] = {
                        defined: true, //CIs where catIds is an empty array are excluded
                        //this is the case for CIs that are exclusively from post module / share link
                        condition: {
                            values: {
                                type: "categorySelection",
                                selection: catSel
                            }
                        }
                    }
                    lg.debug("curFilter[%O] = %O", filterName, curFilter[filterName])
                    break
                }

                case "media": {
                    const checkedTypeInps = inps.slice(0, -1).filter(x => x.checked)
                    const trustedInp = inps[inps.length - 1]
                    curFilter.media = { types: checkedTypeInps.map(x => x.value) as any[] }
                    if (trustedInp.checked) curFilter.media.trusted = true
                    lg.debug("curFilter[%O] = %O", filterName, curFilter[filterName])
                    break
                }

            }
        }

        this.#atom.set(curFilter)
        lg.debug("#updateAtom new %O", fromJson(canonicalJsonStringify(this.get())))
    }

    /**
     * Set the values in the filter dialog from the atom
     */
    async #updateForm() {
        lg.debug("#updateForm")

        const curFilter: Filter<T> = this.get() ?? {}
        for (const filterName of filterFields[this.entity]) {
            const isSet = Object.hasOwn(curFilter, filterName)

            // filter not set => disable fieldset
            this.#ui.filterFieldset(filterName).disabled = !isSet
            this.#ui.filterFieldsetLegendInput(filterName).checked = isSet
            if (!isSet) continue

            switch (filterName) {
                case "location":
                    const filterAtom = curFilter[filterName]!
                    if (filterAtom.defined === false) break
                    if ((filterAtom as any).condition?.values?.type !== "regex") break
                    const re = (filterAtom as any).condition?.values as unknown as ValuesRegex
                    const inp = this.#ui.filterFieldsetFormInputs(filterName, "textarea")[0]
                    const sel = this.#ui.filterFieldsetFormInputs(filterName, "select")[0]
                    const quantifier = (filterAtom as any).condition?.invert ? "=0" : ">0"
                    setSelectValue(sel, quantifier)
                    inp.value = re.patterns.join("\n")
                    filterAtom.condition
                    break

                case "scheme":
                case "posterKind": {
                    const filterAtom = curFilter[filterName]!
                    if (filterAtom.defined === false) break
                    const cond = filterAtom.condition
                    if (cond === undefined || typeof (cond) == "boolean") break
                    if (!Array.isArray(cond.values)) break
                    const filterAtomValues = cond.values.map(x => x.toString() as string)

                    const inps = this.#ui.filterFieldsetFormInputs(filterName, "input")
                    inps.forEach(inpEl => {
                        inpEl.checked = filterAtomValues.includes(inpEl.value)
                    })
                    break
                }

                case "hasAlias": {
                    const filterAtom = (curFilter as Filter<"ci">)[filterName]
                    if (filterAtom === undefined) break
                    if (filterAtom.defined === false) break
                    if (filterAtom.condition === undefined) break
                    if (typeof (filterAtom.condition) != "boolean") break
                    const truthVal = filterAtom.condition!
                    const sel = this.#ui.filterFieldsetFormInputs(filterName, "select")[0]
                    sel.value = truthVal ? "true" : "false"
                    break
                }

                case "waitingTime":
                case "totalWaitingTime":
                case "maxWaitingTime":
                case "echoSum":
                case "echoMax": {
                    const filterAtom = (curFilter as Filter<"ci">)[filterName]
                    if (filterAtom === undefined) break
                    if (filterAtom.defined === false) break
                    if (filterAtom.condition === undefined) break
                    if (typeof (filterAtom.condition) == "boolean") break
                    const values = filterAtom.condition!.values
                    if (Array.isArray(values)) break
                    if (values.type != "interval") break

                    const inps = this.#ui.filterFieldsetFormInputs(filterName, "input")
                    const startInp = inps[0]
                    const endInp = inps[1]
                    startInp.value = (values.start ?? "").toString()
                    endInp.value = (values.end ?? "").toString()
                    break
                }

                case "catIds": {
                    await this.#sourceListLoaded.promise

                    const filterAtom = (curFilter as Filter<"ci">)[filterName]
                    if (filterAtom?.defined !== true) break
                    if (typeof filterAtom.condition == "boolean") break
                    if (Array.isArray(filterAtom.condition?.values)) break
                    if (filterAtom.condition?.values.type != "categorySelection") break
                    const catSel = filterAtom.condition.values
                    for (const item of catSel.selection) {
                        switch (item.type) {
                            case "archive":
                                if (item.categories == undefined) {
                                    const el = this.#ui.sourceContainer().querySelector<HTMLInputElement>("input[value='" + item.archive + "']")!
                                    el.checked = true
                                    el.indeterminate = false
                                } else {
                                    item.categories.forEach(cat => {
                                        const catVal = cat == null ? "" : cat
                                        const elVal = item.archive + " " + catVal
                                        lg.debug("elVal ", elVal)
                                        const el = this.#ui.sourceContainer().querySelector<HTMLInputElement>("input[value='" + elVal + "']")!
                                        el.checked = true
                                    })
                                }
                                break

                            case "rest":
                                this.#ui.sourceUser().checked = true
                                break
                        }
                        //send refresh events to tristate
                    }
                    this.#updateTristates()
                    break
                }

                case "media": {
                    const mediaFilter = (curFilter as Filter<"ci">)["media"]
                    const inps = this.#ui.filterFieldsetFormInputs(filterName, "input")
                    if (inps.length == 0 || mediaFilter == undefined) break

                    const typeInps = inps.slice(0, -1)
                    const trustedInp = inps[inps.length - 1]
                    typeInps.forEach(ti => ti.checked = mediaFilter.types.includes(ti.value as any))
                    trustedInp.checked = mediaFilter.trusted === true
                    break
                }

            }

        }
    }

    #updateSourceList(cats: CategoryMapping) {
        //remember selection
        const checkboxSelection = {
            indeterminate: [] as string[],
            checked: [] as string[]
        }
        this.#ui.sourceContainer().querySelectorAll<HTMLInputElement>("input[type='checkbox']").forEach(inp => {
            if (inp.indeterminate) {
                checkboxSelection.indeterminate.push(inp.value)
                return
            }
            if (inp.checked) {
                checkboxSelection.checked.push(inp.value)
                return
            }
        })

        //generate html and write to DOM
        type TmplDataSourceList = {
            archives: {
                archiveUrl: string,
                categories: {
                    catName: string | null,
                    catId: number
                }[]
            }[]
        }

        const highValChar = "\uffff" //for sorting; null cat is last
        const tmplDataSourceList: TmplDataSourceList = {
            archives: Array.from(cats.archives).map(([archiveUrl, catMap]) => ({
                archiveUrl: archiveUrl,
                categories: Array.from(catMap).map(([catName, catId]) => ({
                    catName: catName,
                    catId: catId
                })).sort((a, b) => (a.catName ?? highValChar) < (b.catName ?? highValChar) ? -1 : 1)
            }))
        }
        lg.debug("src list tmpldata: %O", tmplDataSourceList)

        this.#ui.sourceContainer().innerHTML = tmpl("source_list.html", tmplDataSourceList)

        const allChildCheckboxes = [this.#ui.sourceUser()].concat(Array.from(this.#ui.sourceArchives()), Array.from(this.#ui.sourceCategories()))
        tristateCheckbox(this.#ui.sourceAll(), allChildCheckboxes, this.#ui.sourceContainer())
        //add tristate to all archive checkboxes with more than one cat
        this.#ui.sourceMultiCat().forEach(liEl => {
            tristateCheckbox(liEl.querySelector("input[name='archive']")!, Array.from(liEl.querySelectorAll<HTMLInputElement>("input[name='category']")), liEl)
        })

        //restore selection
        for (const cv of checkboxSelection.checked) {
            const el = this.#ui.sourceContainer().querySelector<HTMLInputElement>("input[value='" + cv + "']")
            if (el != null) el.checked = true
        }
        for (const cv of checkboxSelection.indeterminate) {
            const el = this.#ui.sourceContainer().querySelector<HTMLInputElement>("input[value='" + cv + "']")
            if (el != null) el.indeterminate = true
        }

        this.#updateTristates()
        this.#sourceListLoaded.resolve(null)
    }

    #updateTristates() {
        //update tristate checkboxes
        this.#ui.sourceAll().dispatchEvent(new Event("refresh"))
        this.#ui.sourceMultiCat().forEach(el => el.querySelector<HTMLInputElement>("input[name='archive']")?.dispatchEvent(new Event("refresh")))
    }

    //#region reactive interface and class getter/setter
    get() {
        return this.#atom.get()
    }

    set(value: Filter<T>) {
        this.#atom.set(value)
        this.#updateForm() //update form when filter is set externally
    }

    onChange(f: (newValue: Filter<T>) => void) {
        return this.#atom.onChange(f)
    }

    get value(): Filter<T> {
        return this.get()
    }

    set value(period: Filter<T>) {
        this.set(period)
    }
    //#endregion
}

init()
