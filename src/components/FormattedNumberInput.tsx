"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/input";

interface FormattedNumberInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  className?: string;
}

/**
 * Number input with thousand comma separators.
 * Displays formatted value (e.g., "1,000,000") but stores raw numeric string.
 */
export function FormattedNumberInput({
  value,
  onChange,
  placeholder,
  id,
  className,
}: FormattedNumberInputProps) {
  // Compute display value directly from the value prop (no state sync needed)
  const displayValue = useMemo(() => {
    if (!value) return "";
    const num = parseInt(value.replace(/,/g, ""));
    return isNaN(num) ? "" : num.toLocaleString("en-US");
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    // Strip everything except digits
    const raw = input.replace(/,/g, "").replace(/\D/g, "");
    // Update parent with raw value (parent state change will trigger re-render with formatted display)
    onChange(raw);
  };

  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      value={displayValue}
      onChange={handleChange}
      className={className}
    />
  );
}
