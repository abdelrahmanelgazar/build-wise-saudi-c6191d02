import * as React from "react";
import { cn } from "@/lib/utils";
import { getTextDirection, type TextDirection } from "@/lib/text-direction";
import { useLanguage } from "@/lib/i18n";

export interface InputProps extends React.ComponentProps<"input"> {
  autoDirection?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, dir, autoDirection = true, value, defaultValue, onChange, style, ...props }, ref) => {
    const { direction: appDir } = useLanguage();

    // Structural input types that should ALWAYS be LTR
    const isFixedLtr =
      type === "email" ||
      type === "password" ||
      type === "url" ||
      type === "number" ||
      type === "tel";

    const [currentVal, setCurrentVal] = React.useState<string | number | readonly string[] | undefined>(
      value ?? defaultValue ?? ""
    );

    React.useEffect(() => {
      if (value !== undefined) {
        setCurrentVal(value);
      }
    }, [value]);

    let computedDir: TextDirection | undefined = dir as TextDirection | undefined;

    if (isFixedLtr) {
      computedDir = "ltr";
    } else if (!computedDir && autoDirection) {
      // Auto-detect direction by inspecting entire string (Arabic priority)
      computedDir = getTextDirection(currentVal, appDir) ?? appDir;
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (autoDirection && !isFixedLtr && !dir) {
        setCurrentVal(e.target.value);
      }
      onChange?.(e);
    };

    return (
      <input
        type={type}
        dir={computedDir}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          computedDir === "rtl" ? "text-right" : computedDir === "ltr" ? "text-left" : "",
          className
        )}
        style={{
          direction: computedDir,
          textAlign: computedDir === "rtl" ? "right" : computedDir === "ltr" ? "left" : undefined,
          ...style,
        }}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
