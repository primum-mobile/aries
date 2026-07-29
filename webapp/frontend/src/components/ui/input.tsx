import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-aries-control-appearance="local"
      className={cn(
        "h-[var(--aries-control-height)] w-full min-w-0 rounded-[var(--aries-radius-ui-control)] border border-input bg-transparent px-[var(--aries-control-padding-x)] py-[var(--aries-control-padding-y)] text-[length:var(--aries-font-size-dialog-title)] transition-colors outline-none file:inline-flex file:h-[var(--aries-control-height-compact)] file:border-0 file:bg-transparent file:text-[length:var(--aries-font-size-control)] file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-[length:var(--aries-font-size-control)] dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
