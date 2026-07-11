"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  // Both icons always render; CSS picks one off the `dark` class. This sidesteps
  // the hydration mismatch without a mount guard — the server has no idea which
  // theme wins, but it doesn't need to.
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="size-4 scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0" />
      <Moon className="absolute size-4 scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" />
    </Button>
  );
}
