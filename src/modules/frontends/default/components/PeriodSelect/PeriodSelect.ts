export { PeriodSelect, Period, modName }

import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { dateToString, preferredTmpl } from "../../../../../config.js"
import { tmpl as tmpl0 } from "../../tmpl.js"
import { getInputDate, setInputDate, setSelectValue } from "../../../../libs/etc/misc.js"
import { SerializableQuery } from "../../../../backend/cidb/cidb.js"
import { fromJson, fromJsonTotal, toJson, toNumber } from "../../../../libs/basic/misc.js"
import { watchDialogs } from "../../../../libs/etc/dialogs.js"
import { Tabs } from "../Tabs/Tabs.js"
import { canonicalJsonStringify, equivalentJsonValue } from "../../../../libs/etc/sdst.js"
import { onChange, ReactiveAtom, ReactiveSyncWritableValue, } from "../../../../libs/basic/reactive.js"
import { fallback, hasType, literalGuard } from "../../../../libs/etc/guard.js"
import { periodEx } from "./period.ex.js"

type Period = NonNullable<SerializableQuery<any>["period"]> | null
type ObservedAttributes = typeof PeriodSelect.observedAttributes[number]
type TmplData = {
    presets: {
        value: Period,
        label: string
    }[]
}

const modName = "PeriodSelect"
const tmpl = (name: string, data: any) => tmpl0("components/PeriodSelect/" + name, data, preferredTmpl())
const lg = new DefaultLogger(modName)

const periodPresets: Period[] = [
    null,
    { type: "youngerThan", unit: "day", value: 30 },
    { type: "youngerThan", unit: "day", value: 7 }
]

function init() {
    customElements.define(PeriodSelect.tagName, PeriodSelect)
}

class PeriodSelect extends HTMLElement implements ReactiveSyncWritableValue<Period> {
    static readonly tagName = "sfc-period-select"
    static observedAttributes = ["default"] as const

    #atom = new ReactiveAtom<Period>(null, equivalentJsonValue)

    #shadow: ShadowRoot
    readonly #ui = {
        periodSelect: () => this.#shadow.getElementById("periodSelect") as HTMLSelectElement,
        periodDialog: () => this.#shadow.getElementById("periodDialog") as HTMLDialogElement,

        periodTabs: () => this.#shadow.getElementById("periodDialogTab") as Tabs,
        periodTabsSelected: () => this.#ui.periodTabs().selected() as "youngerThan" | "interval",
        periodYtValue: () => this.#ui.periodTabs().get("youngerThan").contents.querySelector<HTMLInputElement>("input[name='value']")!,
        periodYtUnit: () => this.#ui.periodTabs().get("youngerThan").contents.querySelector<HTMLSelectElement>("select[name='unit']")!,
        periodIntervalStart: () => this.#ui.periodTabs().get("interval").contents.querySelector<HTMLInputElement>("input[name='start']")!,
        periodIntervalEnd: () => this.#ui.periodTabs().get("interval").contents.querySelector<HTMLInputElement>("input[name='end']")!,

        /* generic dialog buttons */
        dialogOkButton: (x: HTMLDialogElement) => x.querySelector(".okButton")! as HTMLButtonElement,
        dialogCloseButton: (x: HTMLDialogElement) => x.querySelector(".closeButton")! as HTMLButtonElement
    }

    constructor() {
        super()
        this.#shadow = this.attachShadow({ mode: "open" })
        const tmplData: TmplData = {
            presets: periodPresets.map(p => ({
                value: p,
                label: periodToLabel(p)
            }))
        }
        this.#shadow.innerHTML = tmpl("period_select.html", tmplData)
        watchDialogs(this.#shadow)

        //set value from default attribute if it exists
        const defaultPeriodStr = this.getAttribute("default")
        if (defaultPeriodStr !== null) this.set(periodFromString(defaultPeriodStr) ?? null)

        //bind <select>'s selected option to atom
        onChange(this, this.#updateSelectedOption.bind(this))

        this.#ui.periodSelect().addEventListener("change", this.#onPeriodSelectChange.bind(this))

        this.#ui.periodDialog().addEventListener("keypress", (ev) => {
            if (ev.key == "Enter") this.#ui.dialogOkButton(this.#ui.periodDialog()).click()
        })
        this.#ui.dialogOkButton(this.#ui.periodDialog()).addEventListener("click", () => this.#ui.periodDialog().close("ok"))
        this.#ui.dialogCloseButton(this.#ui.periodDialog()).addEventListener("click", () => this.#ui.periodDialog().close())
        this.#ui.periodDialog().addEventListener("close", () => {
            if (this.#ui.periodDialog().returnValue == "ok") {
                //user input new period in dialog and confirmed
                let period = this.#periodFromForm()
                if (period != undefined) {
                    lg.debug("ps ", period)
                    this.set(period)
                } else {
                    lg.debug("ps failed")
                    //invalid selction => reset
                    this.#updateSelectedOption(this.get())
                }
            } else {
                //user aborted period dialog
                lg.debug("ps reset")
                //reset selected option to previously selected one before "Custom" was selected
                this.#updateSelectedOption(this.get())
            }

            this.#ui.periodDialog().returnValue = "" //reset ok flag
        })
    }

    /**
     * Handler for when period <select> is changed
     */
    #onPeriodSelectChange() {
        const val = this.#ui.periodSelect().value
        if (val == "custom") {
            this.#ui.periodDialog().showModal()
        } else {
            const period = periodFromString(val)
            this.set(period ?? null)
        }
    }

    /**
     * Sets the form in the dialog with the current atom's value
     */
    async #updateDialogForm() {
        await this.#ui.periodTabs().initialContentLoaded

        //set dialog form to currently selected period
        const curPeriod = this.get()
        if (curPeriod != null) {
            //set form's value to currently selected period
            this.#ui.periodTabs().select(curPeriod.type)
            switch (curPeriod.type) {
                case "interval":
                    setInputDate(this.#ui.periodIntervalStart(), curPeriod.start ?? null)
                    setInputDate(this.#ui.periodIntervalEnd(), curPeriod.end ?? null)
                    break
                case "youngerThan":
                    this.#ui.periodYtValue().value = curPeriod.value.toString()
                    this.#ui.periodYtUnit().value = curPeriod.unit
                    break
            }
        }
    }

    #updateSelectedOption(period: Period) {
        const normalPeriod = fromJson(canonicalJsonStringify(period)) as typeof period
        const selEl = this.#ui.periodSelect()
        setSelectValue(selEl, toJson(normalPeriod), periodToLabel(normalPeriod), selEl.options.length - 1)
    }

    /**
     * Returns the period selected in the dialog form or undefined if invalid
     */
    #periodFromForm(): Period | undefined {
        let period: Period | undefined = undefined
        switch (this.#ui.periodTabsSelected()) {
            case "youngerThan": {
                const value = this.#ui.periodYtValue().value
                const unit = this.#ui.periodYtUnit().value
                period = {
                    type: "youngerThan",
                    value: toNumber(value) ?? 1,
                    unit: fallback(unit, "day", literalGuard("minute", "hour", "day", "week", "month", "year"))
                }
                break
            }

            case "interval": {
                const start = getInputDate(this.#ui.periodIntervalStart()) ?? undefined
                let end = getInputDate(this.#ui.periodIntervalEnd()) ?? undefined
                if (start == undefined && end == undefined) break
                if (end != undefined) end = endOfDay(end)
                period = {
                    type: "interval",
                    start: start,
                    end: end,
                } as Period
                break
            }
        }
        return period
    }

    //#region reactive interface and class getter/setter
    get() {
        return this.#atom.get()
    }

    set(value: Period) {
        this.#atom.set(value)
        this.#updateDialogForm()
    }

    onChange(f: (newValue: Period) => void) {
        return this.#atom.onChange(f)
    }

    get value(): Period {
        return this.get()
    }

    set value(period: Period) {
        this.set(period)
    }
    //#endregion
}

/**
 * If `period` is invalid, it returns undefined.
 */
function periodFromString(period: string): Period | undefined {
    const y = fromJsonTotal(period)
    if (!y.ok) {
        lg.error("Invalid JSON: %O", y.error)
        return undefined
    }
    const z = y.value
    const rv = { value: null }
    if (!hasType(z, periodEx, rv)) {
        lg.error("Invalid data: %O", rv.value)
        return undefined
    }

    return z
}

function periodToLabel(period: Period) {
    if (period === null) return "all time"

    switch (period.type) {
        case "youngerThan":
            return period.value == 1 ? "last " + period.unit :
                "last " + period.value.toString() + " " + period.unit + "s"
        case "interval":
            const startD = period.start == undefined ? "" : dateToString(period.start, "dateOnly")
            const endD = period.end == undefined ? "" : dateToString(period.end, "dateOnly")

            return startD + " - " + endD
    }
}

function endOfDay(date: Date) {
    date.setHours(23, 59, 59, 999)
    return date
}

init()