export interface FieldOption {
  value: string;
  label: string;
}

type OrFn<T, V> = T | ((values: V) => T);

export interface FieldConfig<V extends Record<string, string>> {
  name: keyof V;
  label: OrFn<string, V>;
  // "date" is a plain `YYYY-MM-DD` day — the picked business date every create form carries.
  // Not a datetime: the only thing that date decides is which Fri–Thu settlement period the
  // record lands in, and that boundary falls on a day, so a time would add nothing but a
  // timezone to get wrong.
  kind: OrFn<"select" | "number" | "text" | "multiline" | "date", V>;
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
