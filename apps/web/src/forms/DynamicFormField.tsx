import { TextField, MenuItem } from "@mui/material";
import { todayBusinessDate } from "@gold-platform/types";
import { resolveFieldProp, type FieldConfig } from "./types";

interface DynamicFormFieldProps<V extends Record<string, string>> {
  field: FieldConfig<V>;
  values: V;
  onChange: (name: keyof V, value: string) => void;
}

export function DynamicFormField<V extends Record<string, string>>({
  field,
  values,
  onChange,
}: DynamicFormFieldProps<V>) {
  const label = resolveFieldProp(field.label, values);
  const kind = resolveFieldProp(field.kind, values);
  const helperText = field.helperText?.(values);

  if (kind === "select") {
    const options = field.getOptions?.(values) ?? [];
    return (
      <TextField
        select
        label={label}
        value={values[field.name]}
        onChange={(e) => onChange(field.name, e.target.value)}
        required={field.required}
        helperText={helperText}
      >
        {options.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
    );
  }

  if (kind === "date") {
    return (
      <TextField
        label={label}
        type="date"
        value={values[field.name]}
        onChange={(e) => onChange(field.name, e.target.value)}
        required={field.required}
        helperText={helperText}
        slotProps={{
          // a date input is never empty-looking, so the label has to start shrunk
          inputLabel: { shrink: true },
          // the picker itself refuses tomorrow — the same rule the server enforces, said once
          // more where the operator can see it rather than after a failed submit
          htmlInput: { max: todayBusinessDate() },
        }}
      />
    );
  }

  return (
    <TextField
      label={label}
      type={kind === "number" ? "number" : "text"}
      multiline={kind === "multiline"}
      minRows={kind === "multiline" ? 2 : undefined}
      value={values[field.name]}
      onChange={(e) => onChange(field.name, e.target.value)}
      required={field.required}
      helperText={helperText}
    />
  );
}
