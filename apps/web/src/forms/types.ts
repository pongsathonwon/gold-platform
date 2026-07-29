export interface FieldOption {
  value: string;
  label: string;
}

type OrFn<T, V> = T | ((values: V) => T);

export interface FieldConfig<V extends Record<string, string>> {
  name: keyof V;
  label: OrFn<string, V>;
  kind: OrFn<"select" | "number" | "text" | "multiline", V>;
  required?: boolean;
  isVisible?: (values: V) => boolean;
  getOptions?: (values: V) => FieldOption[];
  helperText?: (values: V) => string | undefined;
}

export function resolveFieldProp<T, V>(prop: OrFn<T, V>, values: V): T {
  return typeof prop === "function" ? (prop as (values: V) => T)(values) : prop;
}

export function getVisibleFields<V extends Record<string, string>>(
  fields: FieldConfig<V>[],
  values: V,
): FieldConfig<V>[] {
  return fields.filter((f) => f.isVisible?.(values) ?? true);
}
