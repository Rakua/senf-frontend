export { CategoryMapping, CategorySelection, getCategories, selectCategories }

import { lg } from "../config.js"
import { db } from "./schema/db.js"
import { defaultCategory } from "./schema/v1.js"

type CatId = number
type CatName = string | null //default category is translated to null
type Archive = string //archive url

type CategoryMapping = {
    archives: Map<Archive, Map<CatName, CatId>>,
    rest: Map<CatName, CatId[]>
}

type CategorySelection = CategorySelectionItem[]
type CategorySelectionItem = CategorySelectionItemArchive | CategorySelectionItemRest
type CategorySelectionItemArchive = {
    type: "archive",
    archive: Archive,
    categories?: CatName[] //undefined => all categories from that archive
}
type CategorySelectionItemRest = {
    type: "rest",
    categories?: CatName[] //undefined => all categories from rest
}

/**
 * Computes the set of category ids from a selection of categories
 */
function selectCategories(selection: CategorySelection, mapping: CategoryMapping): CatId[] {
    let res: CatId[] = []
    for (const x of selection) {
        switch (x.type) {
            case "archive":
                if (x.categories == undefined) {
                    //add all categories from x.archive
                    const arch = mapping.archives.get(x.archive)
                    if (arch == undefined) {
                        lg.warn("Archive (%O) does not exist", x.archive)
                        break
                    }
                    const archArr = Array.from(arch)
                    res = res.concat(archArr.map(x => x[1]))
                    break
                }

                for (const catName of x.categories) {
                    const catId = mapping.archives.get(x.archive)?.get(catName)
                    if (catId == undefined) {
                        lg.warn("Archive category (%O,%O) does not exist", x.archive, catName)
                        break
                    }
                    res.push(catId)
                }

                break

            case "rest":
                if (x.categories == undefined) {
                    //add all categories from rest
                    res = res.concat(Array.from(mapping.rest).flatMap(x => x[1]))
                    break
                }

                for (const catName of x.categories) {                    
                    const catIds = mapping.rest.get(catName)
                    if (catIds == undefined) {
                        lg.warn("Rest category (%O) does not exist", catName)
                        break
                    }
                    res.concat(catIds)
                }
                break
        }
    }
    return res
}

async function getCategories() {
    const res: CategoryMapping = {
        archives: new Map(),
        rest: new Map()
    }

    const rows = await db.t_category.toArray()
    for (const row of rows) {
        const cat = fromInternalCategory(row.category)
        switch (row.sourceType) {
            case "archive": {
                const x = res.archives.get(row.source) ?? new Map<CatName, CatId>()
                x.set(cat, row.catId!)
                res.archives.set(row.source, x)
                break
            }

            case "url":
            case "file": {
                const x = res.rest.get(cat) ?? []
                x.push(row.catId!)
                res.rest.set(cat, x)
                break
            }
        }
    }

    return res
}

function fromInternalCategory(x: string) {
    return x == defaultCategory ? null : x
}