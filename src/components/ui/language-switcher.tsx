import React from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n";
import { Languages } from "lucide-react";

interface LanguageSwitcherProps {
  className?: string;
  variant?: "outline" | "ghost" | "default";
  size?: "default" | "sm" | "lg" | "icon";
}

export function LanguageSwitcher({
  className,
  variant = "outline",
  size = "sm",
}: LanguageSwitcherProps) {
  const { language, toggleLanguage } = useLanguage();

  return (
    <Button
      variant={variant}
      size={size}
      onClick={toggleLanguage}
      className={className}
      title={language === "ar" ? "Switch to English" : "التحويل للغة العربية"}
    >
      <Languages className="h-4 w-4 shrink-0" />
      <span className="font-semibold text-xs tracking-wider">
        {language === "ar" ? "English" : "العربية"}
      </span>
    </Button>
  );
}
