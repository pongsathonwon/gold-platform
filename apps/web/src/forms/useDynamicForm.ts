import { useState } from "react";

export function useDynamicForm<V extends Record<string, string>>(initialValues: V) {
  const [values, setValues] = useState<V>(initialValues);

  function setValue(name: keyof V, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  return { values, setValues, setValue };
}
