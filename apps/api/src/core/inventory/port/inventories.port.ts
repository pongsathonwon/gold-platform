import { Context } from "effect";
import { AppReturnShape } from "../../../infrastructure/utils/usecase.js";
import { LotShape } from "../../../infrastructure/db/schema/inventory.schema.js";
import { UnknownException } from "effect/Cause";
import { AdjustLotReq, VoidLotReq } from "@gold-platform/types";
// For Http call
type InventoryError = UnknownException

export interface ForInventoriesRepository {

}


export class InventoriesRepository extends Context.Tag('inventories/outbound')<ForInventoriesRepository, ForInventoriesRepository>() { }

export interface ForInventoriesUseCase {
    listLot(req: Partial<LotShape>): AppReturnShape<LotShape[], InventoryError>
    adjustLot(req: AdjustLotReq): AppReturnShape<LotShape, InventoryError>
    voidLot(req: VoidLotReq): AppReturnShape<LotShape, InventoryError>
}

export class InventoriesUseCase extends Context.Tag('inventories/usecase')<ForInventoriesRepository, ForInventoriesUseCase>() { }



// For internal usage - ie. subscribe to other domain events/commands or tool calls
export interface ForInternalInvetoriesRepository {

}

export class InternalInventoriesRepository extends Context.Tag('inventories/internal/repository')<InternalInventoriesRepository, ForInternalInvetoriesRepository>() { }

export interface ForInternalInventoriesUsecase {
    increment(): AppReturnShape<unknown, unknown>
    decrement(): AppReturnShape<unknown, unknown>
}

export class InternalInventoriesUseCase extends Context.Tag('inventories/internal/usecase')<InternalInventoriesUseCase, ForInternalInvetoriesRepository>() { }