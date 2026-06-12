import { UnknownException } from "effect/Cause";
import { LotShape } from "../../../infrastructure/db/schema/inventory.schema.js";
import { TApp } from "../../../infrastructure/runtime.js";
import { AppReturnShape } from "../../../infrastructure/utils/usecase.js";
import { ForInternalInventoriesUsecase, ForInventoriesUseCase } from "../port/inventories.port.js";
import { AdjustLotReq, VoidLotReq } from "@gold-platform/types";

export class Inventories implements ForInventoriesUseCase {
    constructor(private readonly runtime: TApp) { }
    listLot(req: Partial<LotShape>): AppReturnShape<LotShape[], UnknownException> {
        // select from inventory lot
        throw new Error("Method not implemented.");
    }
    adjustLot(req: AdjustLotReq): AppReturnShape<LotShape, UnknownException> {
        // gen uuid
        // insert inventory adjust
        // insert inventory lot
        // insert inventory movement
        throw new Error("Method not implemented.");
    }
    voidLot(req: VoidLotReq): AppReturnShape<LotShape, UnknownException> {
        // select inventory lot
        // insert inventory adjustment
        // insert inventory movement
        throw new Error("Method not implemented.");
    }
}

export class InternalInventories implements ForInternalInventoriesUsecase {
    increment(): AppReturnShape<unknown, unknown> {
        // gen uuid
        // insert inventory lot
        // insert into inventory movment
        throw new Error("Method not implemented.");
    }
    decrement(): AppReturnShape<unknown, unknown> {
        // insert into inventory movment
        throw new Error("Method not implemented.");
    }

}