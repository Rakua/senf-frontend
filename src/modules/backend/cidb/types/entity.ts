export {
    EntityName, EntityPropertyKey, EntityPrimaryKey, EntityModel, Entity, EntityPropertyType,
    EntityPropertyTypeNormalized, EntityRecordType,
    IndexedEntityPropertyKey, IndexedEntityPropertyKeyWithArray, OrderablePropertyKey, OrderableType,
    getProperty, toEntity, entityNameToCiType, ciTypeToEntityName
}

import { entities, PrimaryKeyOfEntity, PropertyContext } from "../db/entity.js"
import { FirstArgType, Unarray, Unpromise } from "../../../libs/basic/misc.js"
import { CiType } from "./ci.js"

//#region property types
type Entities = typeof entities
type EntityName = keyof typeof entities
type EntityRecordType<E extends EntityName> = NonNullable<Unarray<Unpromise<ReturnType<typeof entities[E]["fetch"]>>>>
type EntityPropertyKey<E extends EntityName> = keyof Entities[E]["properties"]
type EntityPropertyType<E extends EntityName, K extends EntityPropertyKey<E>> =
    Entities[E]["properties"][K] extends { projection: (x: any, y?: any) => infer RV } ? RV : never

type EntityPropertyTypeNormalized<E extends EntityName, K extends EntityPropertyKey<E>>
    = EntityPropertyTypeNormalized0<E, K> extends CiType ? string : EntityPropertyTypeNormalized0<E, K>
type EntityPropertyTypeNormalized0<E extends EntityName, K extends EntityPropertyKey<E>>
    = Unarray<NonNullable<EntityPropertyType<E, K>>>

type EntityPrimaryKey<E extends EntityName> = Unarray<FirstArgType<Entities[E]["fetch"]>>

type EntityModel<E extends EntityName> = {
    [K in EntityPropertyKey<E>]: () => EntityPropertyType<E, K>
}

//get index property keys by return value of their projection (number, string, Date, number[],...)
type IndexedEntityPropertyKey<E extends EntityName, RV = any> = {
    [P in EntityPropertyKey<E>]: Entities[E]["properties"][P] extends { index: string, projection: (x: any) => RV | undefined } ? P : never
}[EntityPropertyKey<E>]

type IndexedEntityPropertyKeyWithArray<E extends EntityName, RV> =
    IndexedEntityPropertyKey<E, RV | RV[]>

type OrderablePropertyKey<E extends EntityName> = {
    [P in EntityPropertyKey<E>]: Entities[E]["properties"][P] extends OrderablePropertyKey_T3 ? P : never
}[EntityPropertyKey<E>]
type OrderablePropertyKey_T1<T> = { projection: (x: any) => T | undefined }
type OrderablePropertyKey_T2<T> = T extends any ? OrderablePropertyKey_T1<T> : never
type OrderablePropertyKey_T3 = OrderablePropertyKey_T2<OrderableType> //union of projection type for each OrderableType
type OrderableType = string | number | Date
//#endregion

//#region helper functions
function getProperty<E extends EntityName, K extends EntityPropertyKey<E>>(entity: E, key: K) {
    type RV = EntityPropertyType<E, K>
    type Input = EntityRecordType<E>

    return (entities[entity]["properties"] as any)[key] as Property<Input, RV>
}

function toEntity<E extends EntityName>(entity: E, record: EntityRecordType<E>, context: PropertyContext): EntityModel<E> {
    type Entry = [string, Property<EntityRecordType<E>, any>]

    const e = Object.entries(entities[entity]["properties"])
        .map(([key, prop]: Entry) => [key, () => prop.projection(record, context)])

    return Object.fromEntries(e)
}

function entityNameToCiType(x: EntityName): CiType | null {
    switch (x) {
        case "post": return CiType.Post
        case "echo": return CiType.Echo
        default: return null
    }
}

function ciTypeToEntityName(x: CiType): EntityName {
    switch (x) {
        case CiType.Post: return "post"
        case CiType.Echo: return "echo"
    }
    throw new TypeError("CiType " + x + " has no corresponding entity name")
}

//#endregion

//#region type check entities constant
type Entity0<PK, S> = {
    properties: Record<string, Property<S, any>>,
    fetch: (x: PK[]) => Promise<(S | undefined)[]> //ok; uncomment later
}
type Property<S, T> = {
    index?: string,
    projection: (x: S, context: PropertyContext) => T
}

type Entity<E extends EntityName> = Entity0<PrimaryKeyOfEntity<E>, EntityRecordType<E>>
type EntitiesType = { [E in EntityName]: Entity<E> }

/**
 * Checks that for every entity the return type of fetch matches the argument
 * of the projection in every property.
 */
const _entities: EntitiesType = entities
//entities satisfies EntitiesType
//#endregion
