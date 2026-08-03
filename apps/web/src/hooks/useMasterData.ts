import { useQuery } from "@tanstack/react-query";
import { client } from "../api/client";

interface Purity {
  id: string;
  label: string;
  percent: number;
  unitOfMeasure: "g" | "gb";
  active: boolean;
}

interface GoldBrand {
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

export interface ProductTypePurity {
  purityId: string;
  label: string;
  percent: number;
  inputUnit: "kg" | "gb";
  minQuantity: number;
  allowedValues: number[] | null;
}

export function usePurities() {
  return useQuery({
    queryKey: ["master-data", "purities"],
    queryFn: async () => {
      const res = await client["master-data"]["purity-grades"].$get();
      if (!res.ok) throw new Error("Failed to fetch purities");
      return (await res.json()) as { data: Purity[] };
    },
  });
}

export function useBrands() {
  return useQuery({
    queryKey: ["master-data", "brands"],
    queryFn: async () => {
      const res = await client["master-data"].brands.$get();
      if (!res.ok) throw new Error("Failed to fetch brands");
      return (await res.json()) as { data: GoldBrand[] };
    },
  });
}

export function useProductTypes() {
  return useQuery({
    queryKey: ["master-data", "product-types"],
    queryFn: async () => {
      const res = await client["master-data"]["product-types"].$get();
      if (!res.ok) throw new Error("Failed to fetch product types");
      return (await res.json()) as { data: ProductType[] };
    },
  });
}

export function useSuppliers() {
  return useQuery({
    queryKey: ["master-data", "suppliers"],
    queryFn: async () => {
      const res = await client["master-data"].suppliers.$get();
      if (!res.ok) throw new Error("Failed to fetch suppliers");
      return (await res.json()) as { data: Supplier[] };
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
      if (!res.ok) throw new Error("Failed to fetch purities for product type");
      return (await res.json()) as { data: ProductTypePurity[] };
    },
  });
}
