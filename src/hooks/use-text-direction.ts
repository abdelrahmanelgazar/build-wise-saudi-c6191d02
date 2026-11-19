import { useState, useEffect, useCallback } from "react";
import { getTextDirection, type TextDirection } from "@/lib/text-direction";
import { useLanguage } from "@/lib/i18n";

export function useTextDirection(
  initialValue: string | number | undefined = "",
  explicitDir?: TextDirection
) {
  const { direction: appDirection } = useLanguage();
  const [direction, setDirection] = useState<TextDirection>(() => {
    if (explicitDir) return explicitDir;
    return getTextDirection(initialValue, appDirection) ?? appDirection;
  });

  const updateDirection = useCallback(
    (val: string | number | undefined) => {
      if (explicitDir) return;
      const detected = getTextDirection(val, appDirection);
      if (detected && detected !== direction) {
        setDirection(detected);
      }
    },
    [explicitDir, appDirection, direction]
  );

  useEffect(() => {
    if (!explicitDir) {
      setDirection(getTextDirection(initialValue, appDirection) ?? appDirection);
    }
  }, [appDirection, explicitDir, initialValue]);

  return { direction, updateDirection };
}
