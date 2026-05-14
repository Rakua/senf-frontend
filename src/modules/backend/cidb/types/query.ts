export {
    Query, QueryIndex, QueryOrder, QueryFilter, Variables, ValuesSet as IndexValuesSet,
    SerializableQuery, SerializableQueryIndex, SerializableQueryFilter, SerializableQueryOrder,
    IndexTypeLiteral, IndexType,
    SerializableQueryFilterAtomCondition, ValuesInterval, ValuesYoungerThan, ValuesRegex,
    TimeUnit, SortOrder,
    fromSerializableQuery, timeUnitToFactor, youngerThan, literals
}

import { isTrustedLocation } from "../../../../config.js"
import { mediaTypeFromUrl } from "../../../libs/etc/misc.js"
import { CategorySelection } from "../cidb.js"
import { lg } from "../config.js"
import { CategoryMapping, selectCategories } from "../db/category.js"
import { EntityModel, EntityName, EntityPrimaryKey, EntityPropertyKey, IndexedEntityPropertyKeyWithArray, OrderablePropertyKey, OrderableType } from "./entity.js"

type Query<E extends EntityName> = {
    entity: E,
    index: QueryIndex<E> | EntityPrimaryKey<E>[], //index condition or set of primary keys
    filter?: QueryFilter<E>,
    order?: QueryOrder<E>
}

type QueryIndex<E extends EntityName> =
    QueryIndexString<E> | QueryIndexNumber<E> | QueryIndexDate<E>

type QueryIndexString<E extends EntityName> = {
    type: "string",
    name: IndexedEntityPropertyKeyWithArray<E, string>,
    prefix?: boolean, //false by default
    ignoreCase?: boolean, //false by default
    values: ValuesSet<string>
}

type QueryIndexNumber<E extends EntityName> = { type: "number" } & QueryIndexNumberlike<number, E>
type QueryIndexDate<E extends EntityName> = { type: "date" } & (QueryIndexNumberlike<Date, E> | {
    name: IndexedEntityPropertyKeyWithArray<E, Date>,
    values: ValuesYoungerThan
})
type QueryIndexNumberlike<X extends number | Date, E extends EntityName> = {
    name: IndexedEntityPropertyKeyWithArray<E, X>,
    values: ValuesSet<X> | ValuesInterval<X>
}

type ValuesSet<T> = { type: "set", literals: T[], variables?: { name: string, parameter?: string }[] }
type ValuesInterval<T extends number | Date> =
    { type: "interval", start: T, end?: T } |
    { type: "interval", start?: T, end: T }
type ValuesYoungerThan = { type: "youngerThan", unit: TimeUnit, value: number }

type ValuesRegex = { type: "regex", patterns: string[] }
type ValuesCategorySelection = { type: "categorySelection", selection: CategorySelection }

type QueryFilter<E extends EntityName> = (x: EntityModel<E>) => boolean

type QueryOrder<E extends EntityName> = QueryOrderLexicographic<E>
type QueryOrderLexicographic<E extends EntityName> = {
    type: "lexicographic",
    position: (x: EntityModel<E>) => OrderTuple,
    ascending: boolean[]
}
type OrderTuple = [...(OrderableType | undefined)[]]
type OrderTupleToAscTuple<O extends OrderTuple> = { [Index in keyof O]: SortOrder }

function lexicographicOrder<E extends EntityName, O extends OrderTuple>(entity: E, position: (x: EntityModel<E>) => [...O], ascending: OrderTupleToAscTuple<O>): QueryOrderLexicographic<E> {
    return {
        type: "lexicographic",
        position: position,
        ascending: ascending.map(x => x == "asc")
    }
}

type IndexTypeLiteral = QueryIndex<any>["type"]
type IndexType<T extends IndexTypeLiteral> =
    T extends "string" ? string : T extends "number" ? number : T extends "date" ? Date : never
type VariableName = string

type Variables = {
    [VarType in IndexTypeLiteral]: {
        constant: Record<VariableName, () => IndexType<VarType>[]>,
        parameterized: Record<VariableName, (param: string) => IndexType<VarType>[]>
    }
}

type TimeUnit = typeof timeUnit[number]
type SortOrder = typeof sortOrder[number]

const timeUnit = ["minute", "hour", "day", "week", "month", "year"] as const
const sortOrder = ["asc", "desc"] as const
const literals = {
    timeUnit: timeUnit,
    sortOrder: sortOrder
}

//#region serializable query components

/**
 * If `period` is null, the all-time period is assumed.
 * If `period` is undefined, no time period is specified
 * and the index/filter are not modified. 
 */
type SerializableQuery<E extends EntityName> = {
    //entity: E,
    index: SerializableQueryIndex<E>,
    filter?: SerializableQueryFilter<E>,
    order?: SerializableQueryOrder<E>,
    period?: ValuesYoungerThan | ValuesInterval<Date> | null
}

type SerializableQueryIndex<E extends EntityName> = QueryIndex<E> | EntityPrimaryKey<E>[]

type SerializableQueryOrder<E extends EntityName> = {
    column: OrderablePropertyKey<E>,
    order: SortOrder
}[]

type SerializableQueryFilter<E extends EntityName> =
    Partial<Record<EntityPropertyKey<E>, SerializableQueryFilterAtom> & {
        invert?: boolean,
        media?: SerializableQueryFilterMedia
    }>

type SerializableQueryFilterMedia = {
    types: SerializableQueryFilterMediaType[],
    trusted?: boolean
}
type SerializableQueryFilterMediaType = "audio" | "image" | "video"

type SerializableQueryFilterAtom = { defined: false } | {
    defined?: true, //undefined means can be either
    condition?: boolean | SerializableQueryFilterAtomCondition
}

type SerializableQueryFilterAtomCondition = {
    values: any[] | ValuesInterval<number> | ValuesInterval<Date> | ValuesYoungerThan | ValuesRegex | ValuesCategorySelection,
    invert?: boolean
}

/**
 * Converts a seriaziable query into a query 
 */
function fromSerializableQuery<E extends EntityName>(entity: E, sq0: SerializableQuery<E>, categoryMapping: CategoryMapping): Query<E> {
    const periodField = {
        "post": "postedOn",
        "echo": "postedOn",
        "ciMetadata": "postedOn",
        "location": "firstCi",
        "poster": "firstCi"
    } as const

    const sq = structuredClone(sq0)
    /**
     * todo: 
     * - add null to SerializableQueryIndex and QueryIndex type (means all rows)
     * - if index and period are null and the order is a single indexed column
     *   - special query (logic must be implemented in queryWithProgress)
     */

    if (sq.period !== undefined) {
        const periodCol = periodField[entity] as string

        //check if period should be applied to index or to filter
        if (!Array.isArray(sq.index) && sq.index.name as string === periodCol) {
            //apply period to index
            lg.debug("apply period to index")
            if (sq.period === null) {
                sq.index.values = { type: "interval", start: new Date(0) }
            } else {
                sq.index.values = sq.period
            }

        } else {
            //apply period to filter
            lg.debug("apply period to filter")
            if (sq.filter == undefined) sq.filter = {};

            if (sq.period === null) {
                delete (sq.filter as Record<string, SerializableQueryFilterAtom>)[periodCol]
            } else {
                (sq.filter as Record<string, SerializableQueryFilterAtom>)[periodCol] = {
                    defined: true,
                    condition: {
                        values: sq.period
                    }
                }
            }
        }
    }

    delete sq.period
    lg.debug("resulting serializable query: %O", sq)

    return {
        entity: entity,
        index: sq.index,
        filter: sq.filter ? fromSerializableQueryFilter<E>(sq.filter, categoryMapping) : undefined,
        order: sq.order ? fromSerializableQueryOrder(entity, sq.order) : undefined
    }
}

function fromSerializableQueryFilter<E extends EntityName>(filter: SerializableQueryFilter<E>, categoryMapping: CategoryMapping): QueryFilter<E> {
    return function (x: EntityModel<E>): boolean {
        let res = true
        for (const prop in filter) {
            if (prop == "invert" || prop == "media") continue //not a model property => skip            

            const prop0 = prop as EntityPropertyKey<E>
            const f = filter[prop0] as SerializableQueryFilterAtom

            if (x[prop0] == undefined) {
                lg.debug("entity %O does not have property %s", x, prop0)
                continue
            }

            const propVal = (x[prop0] as () => any)()

            //if prop is "catIds" then an empty array is considered to be undefined as well
            const isUndefined = propVal === undefined
                || (prop0 == "catIds" && propVal?.length === 0)

            if (f.defined !== undefined) {
                //check if prop value is defined / undefined
                res &&= !isUndefined == f.defined
            }
            if (f.defined === false || f.condition === undefined || isUndefined) {
                //continue with next filter atom if current filter atom says property 
                //should be undefined or there is no condition to check or the property value
                //is undefined (conditions are only applied to defined values)
                continue
            }

            if (typeof f.condition == "boolean") {
                if (typeof propVal !== "boolean") {
                    lg.warn("Property %s is not boolean; ignoring filter part %O", prop0, f)
                    continue
                }
                res &&= propVal === f.condition
                continue
            }

            const cond = f.condition as SerializableQueryFilterAtomCondition
            let res0: boolean
            if (Array.isArray(cond.values)) {
                const cv = cond.values as any[]
                res0 = cv.includes(propVal)
            } else if (cond.values.type == "youngerThan") {
                if (!(propVal instanceof Date)) {
                    lg.warn("Property %s is not a date; ignoring filter part %O", prop0, f)
                    continue
                }
                res0 = youngerThan(propVal as Date, cond.values.value, cond.values.unit)
            } else if (cond.values.type == "regex") {
                if (typeof propVal != "string") {
                    lg.warn("Property %s is not a string; ignoring filter part %O", prop0, f)
                    continue
                }

                res0 = false
                for (const p of cond.values.patterns) {
                    try {
                        const re = new RegExp(p, "v")
                        if (re.exec(propVal) !== null) {
                            res0 = true
                            break
                        }
                    } catch (e) {
                        lg.warn("Property %s has invalid pattern (%s, error %O); ignoring it", prop0, p, e)
                    }
                }
            } else if (cond.values.type == "categorySelection") {
                if (prop0 != "catIds") {
                    lg.warn("Category selection only valid for 'catIds' property but got '%s'", prop0)
                    continue
                }

                const selectedCatIds = new Set(selectCategories(cond.values.selection, categoryMapping))
                const entityCatIds = new Set(x.catIds() as number[])
                res0 = !selectedCatIds.isDisjointFrom(entityCatIds)
            } else {
                const cv = cond.values
                res0 = true
                if (cv.start !== undefined) {
                    if (typeof cv.start != typeof propVal) {
                        lg.warn("Property %s is not a %s; ignoring filter part %O", prop0, typeof cv.start, f)
                        continue
                    }
                    res0 &&= cv.start <= propVal
                }
                if (cv.end !== undefined) {
                    if (typeof cv.end != typeof propVal) {
                        lg.warn("Property %s is not a %s; ignoring filter part %O", prop0, typeof cv.end, f)
                        continue
                    }
                    res0 &&= propVal <= cv.end
                }
            }

            res &&= cond.invert === true ? !res0 : res0
        }

        if (filter.media !== undefined) res &&= mediaFilter(x,filter.media)           
        return filter.invert === true ? !res : res
    }
}

function mediaFilter(x: EntityModel<any>, filterMedia: SerializableQueryFilterMedia) {
    const locf = x.location as (() => string) | undefined
    if(locf == undefined) return false
    const loc = locf()
    const url = URL.parse(loc)
    if(url == null) return false

    let res = filterMedia.types.includes((mediaTypeFromUrl(url) ?? "") as any)
    if(filterMedia.trusted === true) res &&= isTrustedLocation(loc)
    return res
}

function fromSerializableQueryOrder<E extends EntityName>(entity: E, order: SerializableQueryOrder<E>): QueryOrder<E> {
    return lexicographicOrder(entity, ed => order.map(x => {
        const col = x.column
        if (!Object.hasOwn(ed, col)) return 0 //use 0 as default if column does not exist        
        const proj = ed[col] as () => OrderableType
        return proj()
    }), order.map(x => x.order))
}
//#endregion

//#region helpers
function youngerThan(x: Date, value: number, unit: TimeUnit) {
    return x > new Date(Date.now() - timeUnitToFactor(unit) * value)
}

function timeUnitToFactor(unit: TimeUnit) {
    switch (unit) {
        case "minute": return 1000 * 60
        case "hour": return 1000 * 60 * 60
        case "day": return 1000 * 60 * 60 * 24
        case "week": return 1000 * 60 * 60 * 24 * 7
        case "month": return 1000 * 60 * 60 * 24 * 30
        case "year": return 1000 * 60 * 60 * 24 * 365
    }
}
//#endregion