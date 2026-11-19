import * as React from "react";
import { cn } from "@/lib/utils";
import { getTextDirection, type TextDirection } from "@/lib/text-direction";
import { useLanguage } from "@/lib/i18n";

export interface TextareaProps extends React.ComponentProps<"textarea"> {
  autoDirection?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, dir, autoDirection = true, value, defaultValue, onChange, style, ...props }, ref) => {
    const { direction: appDir } = useLanguage();

    const [currentVal, setCurrentVal] = React.useState<string | number | readonly string[] | undefined>(
      value ?? defaultValue ?? ""
    );

    React.useEffect(() => {
      if (value !== undefined) {
        setCurrentVal(value);
      }
    }, [value]);

    let computedDir: TextDirection | undefined = dir as TextDirection | undefined;

    if (!computedDir && autoDirection) {
      computedDir = getTextDirection(currentVal, appDir) ?? appDir;
    }

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (autoDirection && !dir) {
        setCurrentVal(e.target.value);
      }
      onChange?.(e);
    };

    return (
      <textarea
        dir={computedDir}
        className={cn(
          "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
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
Textarea.displayName = "Textarea";

export { Textarea };
