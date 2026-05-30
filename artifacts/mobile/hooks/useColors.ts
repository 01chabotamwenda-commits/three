import { useContext } from "react";
import { useColorScheme } from "react-native";

import colors from "@/constants/colors";
import { AppContext } from "@/context/AppContext";

/**
 * Returns the design tokens for the current effective color scheme.
 *
 * The effective scheme is determined by:
 *  1. The user's in-app override (stored in AppContext / AsyncStorage), if set.
 *  2. Otherwise, the device's system appearance setting.
 *
 * Also returns `isDark` (boolean) for convenience.
 */
export function useColors() {
  const systemScheme = useColorScheme();
  const ctx = useContext(AppContext);
  const override = ctx?.themeOverride ?? "system";

  const effectiveScheme =
    override === "system" ? (systemScheme ?? "dark") : override;

  const palette =
    effectiveScheme === "light" ? colors.light : colors.dark;

  return {
    ...palette,
    radius: colors.radius,
    isDark: effectiveScheme !== "light",
    scheme: effectiveScheme as "light" | "dark",
  };
}
