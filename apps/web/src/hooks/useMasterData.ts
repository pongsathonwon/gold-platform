import { useQuery } from "@tanstack/react-query";
import { client } from "../api/client";

export function usePurities() {
  return useQuery({
    queryKey: ["master-data", "purities"],
    queryFn: () => client["master-data"]["purity-grades"].$get().then((r) => r.json()),
  });
}

export function useBrands() {
  return useQuery({
    queryKey: ["master-data", "brands"],
    queryFn: () => client["master-data"].brands.$get().then((r) => r.json()),
  });
}

export function useProductTypes() {
  return useQuery({
    queryKey: ["master-data", "product-types"],
    queryFn: () => client["master-data"]["product-types"].$get().then((r) => r.json()),
  });
}
