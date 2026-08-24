import { useQuery } from "@tanstack/react-query";
import { assertOk, client } from "../api/client";

interface Purity {
  id: string;
  label: string;
  percent: number;
  unitOfMeasure: "g" | "gb";
  active: boolean;
}

export interface GoldBrand {
  id: string;
  brand: string;
  nonFungible: boolean;
  active: boolean;
}

interface ProductType {
  id: string;
  productType: string;
  supplierTradeable: boolean;
  active: boolean;
}

export interface Supplier {
  id: string;
  supplierName: string;
  brandLock: boolean;
  active: boolean;
}

export interface Branch {
  branchCode: string;
  branchName: string;
  branchShortName: string;
  active: boolean;
  /** Removed from the system. Null means live — see `liveBranches()`. */
  deletedAt: string | null;
}

export interface ProductTypePurity {
  purityId: string;
  label: string;
  percent: number;
  inputUnit: "kg" | "gb";
  minQuantity: number;
  allowedValues: number[] | null;
  // the increment valid weights land on (96.5% gold bar steps by 5); null means no step rule
  stepQuantity: number | null;
}

export function usePurities() {
  return useQuery({
    queryKey: ["master-data", "purities"],
    queryFn: async () => {
      const res = await client["master-data"]["purity-grades"].$get();
      await assertOk(res, "Failed to fetch purities");
      return (await res.json()) as { data: Purity[] };
    },
  });
}

export function useBrands() {
  return useQuery({
    queryKey: ["master-data", "brands"],
    queryFn: async () => {
      const res = await client["master-data"].brands.$get();
      await assertOk(res, "Failed to fetch brands");
      return (await res.json()) as { data: GoldBrand[] };
    },
  });
}

export function useProductTypes() {
  return useQuery({
    queryKey: ["master-data", "product-types"],
    queryFn: async () => {
      const res = await client["master-data"]["product-types"].$get();
      await assertOk(res, "Failed to fetch product types");
      return (await res.json()) as { data: ProductType[] };
    },
  });
}

export function useSuppliers() {
  return useQuery({
    queryKey: ["master-data", "suppliers"],
    queryFn: async () => {
      const res = await client["master-data"].suppliers.$get();
      await assertOk(res, "Failed to fetch suppliers");
      return (await res.json()) as { data: Supplier[] };
    },
  });
}

// The brands a supplier ships — the enterable lines of a brand split. A brandLock supplier
// returns exactly one and the operator enters nothing; anyone else's registered brands become
// the fields, with the fungible pool taking whatever is left over.
export function useSupplierBrands(supplierId: string) {
  return useQuery({
    queryKey: ["master-data", "suppliers", supplierId, "brands"],
    enabled: !!supplierId,
    queryFn: async () => {
      const res = await client["master-data"].suppliers[":id"].brands.$get({
        param: { id: supplierId },
      });
      await assertOk(res, "Failed to fetch brands for supplier");
      return (await res.json()) as { data: GoldBrand[] };
    },
  });
}

// purities valid for a given product type, plus the weight input unit/quantity rule for each
export function useProductTypePurities(productTypeId: string) {
  return useQuery({
    queryKey: ["master-data", "product-types", productTypeId, "purities"],
    enabled: !!productTypeId,
    queryFn: async () => {
      const res = await client["master-data"]["product-types"][":id"].purities.$get({
        param: { id: productTypeId },
      });
      await assertOk(res, "Failed to fetch purities for product type");
      return (await res.json()) as { data: ProductTypePurity[] };
    },
  });
}

/**
 * Every branch, retired ones included.
 *
 * The endpoint deliberately does not filter. A branch that closed still has to resolve its name on
 * every transaction it ever recorded, so filtering server-side would leave historical rows showing
 * a bare code. Choosing what to *offer* is a form's decision — see `liveBranches()`.
 */
export function useBranches() {
  return useQuery({
    queryKey: ["master-data", "branches"],
    queryFn: async () => {
      const res = await client["master-data"].branches.$get();
      await assertOk(res, "Failed to fetch branches");
      return (await res.json()) as { data: Branch[] };
    },
  });
}

/** The branches a new record may be filed against: not retired, and currently trading. */
export const liveBranches = (branches: Branch[] = []) =>
  branches.filter((b) => !b.deletedAt && b.active);
