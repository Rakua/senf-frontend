export { PlacesPage, modName }

import { tmpl as tmpl0 } from "../../tmpl.js"
import { preferredTmpl } from "../../../../../config.js"
import { DefaultLogger } from "../../../../libs/basic/logger.js"
import { pageTitleR } from "../../App/App.js"
import { ExposedPromise } from "../../../../libs/basic/misc.js"
import { LocationGallery } from "../../components/LocationGallery/LocationGallery.js"
import { queryWithoutProgress, SerializableQuery } from "../../../../backend/cidb/cidb.js"
import { orderPresets, QueryBar } from "../../components/QueryBar/QueryBar.js"
import { onChange } from "../../../../libs/basic/reactive.js"

const modName = "PlacesPage"
const tmpl = (name: string, data: any) => tmpl0("pages/Places/" + name, data, preferredTmpl())
const lg = new DefaultLogger(modName)

function init() {
    customElements.define(PlacesPage.tagName, PlacesPage)
}

class PlacesPage extends HTMLElement {
    static readonly pageName = "places"
    static readonly tagName = "sf-places"

    #contentLoaded = new ExposedPromise<void>()
    readonly initialContentLoaded = this.#contentLoaded.promise
    #shadow: ShadowRoot
    readonly #ui = {
        querybar: () => this.#shadow.getElementById("querybar") as HTMLElement,
        gallery: () => this.#shadow.getElementById("gallery") as HTMLElement,
        placeCount: () => this.#shadow.getElementById("placeCount") as HTMLElement,
    }

    async #init() {
        const query: SerializableQuery<"location"> = {
            index: {
                type: "date",
                name: "firstCi",
                values: { type: "interval", start: new Date(0) }
            },
            order: orderPresets.location[0].value,
            filter: {
                scheme: {
                    defined: true,
                    condition: { values: ["http", "https"] }
                }
            },
            period: {
                type: "youngerThan",
                value: 30,
                unit: "day"
            }
        }

        const querybar = new QueryBar("location", query)        
        this.#ui.querybar().replaceChildren(querybar)        
        const liveQuery = await querybar.liveQueryLocation()
        onChange(liveQuery, async (query) => {
            const pks = await queryWithoutProgress(await query)
            const gallery = new LocationGallery(pks, { scrollToEl: this.#ui.querybar() })
            await gallery.initialContentLoaded

            this.#ui.placeCount().innerText = pks.length.toString()
            this.#ui.gallery().replaceChildren(gallery)
            this.#contentLoaded.resolve()
        })
        querybar.initialContentLoaded.then(() => querybar.loadDefaultQuery("places"))
    }

    constructor() {
        super()
        pageTitleR.set("Places")

        this.#shadow = this.attachShadow({ mode: "closed" })
        this.#shadow.innerHTML = tmpl("places.html", {});
        this.#init()
    }
}

init()